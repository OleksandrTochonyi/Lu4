import {
  CraftEntry,
  CraftRecipe,
  buildNameIndex,
  normName,
} from '../services/craft-catalog.service';
import { StockItem } from '../services/warehouse.service';

/** one line of the "what does this cost" tree */
export interface CostNode {
  /** unique per tree position (carries depth + name) — for *ngFor / expand state */
  key: string;
  /** resource identity (catalogId or normalized name) — for aggregating across the tree */
  resKey: string;
  name: string;
  icon?: string;
  grade: string | null;
  category: string | null;
  /** FULL recipe requirement for this branch — as if nothing were on the shelf above it */
  needFull: number;
  /** NET requirement — `needFull` reduced by stock of composites held above this node */
  need: number;
  /** clan stock ACTUALLY allocated to this line (one shared pool, consumed in order) */
  have: number;
  /** max(0, need - have) — the gap this line still has after its stock allocation */
  missing: number;
  /** units still unobtainable after crafting intermediates. Leaf: == missing; composite: Σ children */
  effShort: number;
  /** covered = pool covered it · craftable = its sub-craft covers it · short = real deficit */
  status: 'covered' | 'craftable' | 'short';
  craftable: boolean;
  children: CostNode[];
}

/** a mutable copy of the clan stock, drawn down as the cost tree is evaluated */
interface StockPool {
  byCat: Map<string, number>;
  byNm: Map<string, number>;
}

export interface PlanRoot {
  recipe: CraftRecipe;
  qty: number;
}

export interface CostPlan {
  /** every top-level ingredient node, across all roots, sharing one stock pool */
  tree: CostNode[];
  /** one row per resource, summed across the whole plan */
  rollup: CostNode[];
  /** rollup rows with `effShort > 0`, name-sorted — the "buy / farm" list */
  shortfall: CostNode[];
}

export const MAX_DEPTH = 8;

/**
 * Row ordering for a resource list: recipes on top, then parts ("куски"), then
 * plain resources, then crystals / gemstones at the bottom.
 */
function typeRank(n: Pick<CostNode, 'category' | 'name' | 'resKey'>): number {
  if (n.category === 'recipe') return 0;
  if (n.category === 'part') return 1;
  if (
    /crystal|gemstone|кристал|самоцвет|гемстоун/i.test(n.name) ||
    /^(?:crystal|gemstone)_/i.test(n.resKey)
  ) {
    return 3;
  }
  return 2;
}

/** typeRank → shortages first → name */
function byTypeThenNeed(a: CostNode, b: CostNode): number {
  return (
    typeRank(a) - typeRank(b) ||
    Number(b.effShort > 0) - Number(a.effShort > 0) ||
    a.name.localeCompare(b.name)
  );
}

/** best recipe for auto-expansion: prefer a material/sub-assembly, then highest chance */
export function pickRecipe(entry: CraftEntry): CraftRecipe | null {
  if (!entry.recipes.length) return null;
  const mat = entry.recipes.find((r) => r.source === 'material');
  if (mat) return mat;
  return [...entry.recipes].sort(
    (a, b) => (parseInt(b.chance) || 0) - (parseInt(a.chance) || 0),
  )[0];
}

/** human label for a recipe option (60% / 70% / 100% / material) */
export function recipeLabel(r: CraftRecipe): string {
  return r.source === 'material'
    ? 'Материал / сборка'
    : `Рецепт${r.chance ? ' ' + r.chance : ''}`;
}

/**
 * Stateless per-call cost calculator. Build one with the live catalogue + stock,
 * then `computePlan([...])` any number of finished items (one, or a whole set)
 * against a SINGLE shared stock pool.
 */
export class CraftCostCalc {
  private readonly byId: Map<string, CraftEntry>;
  private readonly byName: Map<string, CraftEntry>;
  private readonly stockIndex: { byCat: Map<string, number>; byNm: Map<string, number> };

  constructor(allEntries: CraftEntry[], stock: StockItem[]) {
    this.byId = new Map((allEntries ?? []).map((e) => [e.id, e]));
    this.byName = buildNameIndex(allEntries ?? []);
    const byCat = new Map<string, number>();
    const byNm = new Map<string, number>();
    for (const s of stock ?? []) {
      if (s.catalogId) byCat.set(s.catalogId, (byCat.get(s.catalogId) ?? 0) + s.qty);
      const n = normName(s.name);
      if (n) byNm.set(n, (byNm.get(n) ?? 0) + s.qty);
    }
    this.stockIndex = { byCat, byNm };
  }

  private resolve(name: string, catalogId: string | null): CraftEntry | undefined {
    if (catalogId) {
      const hit = this.byId.get(catalogId);
      if (hit) return hit;
    }
    return this.byName.get(normName(name));
  }

  private makePool(): StockPool {
    return {
      byCat: new Map(this.stockIndex.byCat),
      byNm: new Map(this.stockIndex.byNm),
    };
  }

  private drawFromPool(
    pool: StockPool,
    entry: CraftEntry | undefined,
    name: string,
    want: number,
  ): number {
    if (want <= 0) return 0;
    if (entry && pool.byCat.has(entry.id)) {
      const avail = pool.byCat.get(entry.id) ?? 0;
      const used = Math.min(want, avail);
      if (used > 0) pool.byCat.set(entry.id, avail - used);
      return used;
    }
    const nm = normName(name);
    const avail = pool.byNm.get(nm) ?? 0;
    const used = Math.min(want, avail);
    if (used > 0) pool.byNm.set(nm, avail - used);
    return used;
  }

  private buildNode(
    name: string,
    catalogId: string | null,
    needFull: number,
    needNet: number,
    path: Set<string>,
    depth: number,
    pool: StockPool,
  ): CostNode {
    const entry = this.resolve(name, catalogId);
    const craftable = !!entry?.craftable;
    const resKey = entry?.id ?? normName(name);
    const key = resKey + '@' + depth + ':' + name;

    // draw this resource (raw OR a finished intermediate) from the shared pool —
    // consumed once across the whole plan; allocation is against the NET need
    const have = this.drawFromPool(pool, entry, name, needNet);
    const missing = Math.max(0, needNet - have);

    const sub =
      entry && craftable && depth < MAX_DEPTH && !path.has(entry.id)
        ? pickRecipe(entry)
        : null;

    let children: CostNode[] = [];
    let effShort = missing;

    if (sub && entry) {
      const nextPath = new Set(path).add(entry.id);
      const outQ = sub.outputQty || 1;
      const fullBatches = Math.max(1, Math.ceil(needFull / outQ));
      if (missing > 0) {
        const netBatches = Math.max(1, Math.ceil(missing / outQ));
        children = sub.ingredients.map((ing) =>
          this.buildNode(
            ing.name,
            ing.catalogId,
            ing.qty * fullBatches,
            ing.qty * netBatches,
            nextPath,
            depth + 1,
            pool,
          ),
        );
        effShort = children.reduce((s, c) => s + c.effShort, 0);
      } else {
        // fully covered — keep the breakdown for display against a throwaway
        // snapshot so it spends nothing and counts nothing
        const snapshot: StockPool = {
          byCat: new Map(pool.byCat),
          byNm: new Map(pool.byNm),
        };
        children = sub.ingredients.map((ing) =>
          this.buildNode(
            ing.name,
            ing.catalogId,
            ing.qty * fullBatches,
            ing.qty * fullBatches,
            nextPath,
            depth + 1,
            snapshot,
          ),
        );
      }
    }

    const status: CostNode['status'] =
      missing === 0 ? 'covered' : effShort === 0 ? 'craftable' : 'short';

    return {
      key,
      resKey,
      name: entry?.name ?? name,
      icon: entry?.icon,
      grade: entry?.grade ?? null,
      category: entry?.category ?? null,
      needFull,
      need: needNet,
      have,
      missing,
      effShort,
      status,
      craftable,
      children,
    };
  }

  /** leaves for aggregation — a `covered` node is a leaf even with an info breakdown */
  private static leaves(tree: CostNode[]): CostNode[] {
    const out: CostNode[] = [];
    const walk = (n: CostNode) => {
      if (n.children.length && n.status !== 'covered') n.children.forEach(walk);
      else out.push(n);
    };
    tree.forEach(walk);
    return out;
  }

  private static rollup(tree: CostNode[]): CostNode[] {
    const acc = new Map<string, CostNode>();
    for (const n of CraftCostCalc.leaves(tree)) {
      const cur = acc.get(n.resKey);
      if (cur) {
        cur.needFull += n.needFull;
        cur.need += n.need;
        cur.have += n.have;
        cur.missing += n.missing;
        cur.effShort += n.effShort;
      } else {
        acc.set(n.resKey, { ...n, key: n.resKey, children: [] });
      }
    }
    return [...acc.values()]
      .map((n) => ({ ...n, status: n.effShort > 0 ? 'short' : 'covered' }) as CostNode)
      .sort(byTypeThenNeed);
  }

  computePlan(roots: PlanRoot[]): CostPlan {
    // 1. aggregate top-level demand per resource across EVERY root, so the plan
    //    is treated as one order — a resource needed by several items (Crystal:
    //    C-Grade, Gemstone B, Cord, …) becomes ONE row, not one per item.
    const demand = new Map<
      string,
      { name: string; catalogId: string | null; qty: number }
    >();
    for (const root of roots ?? []) {
      const r = root?.recipe;
      if (!r) continue;
      const qty = Math.max(1, Math.round(root.qty || 1));
      const batches = Math.max(1, Math.ceil(qty / (r.outputQty || 1)));
      for (const ing of r.ingredients) {
        const entry = this.resolve(ing.name, ing.catalogId);
        const k = entry?.id ?? normName(ing.name);
        const cur = demand.get(k) ?? {
          name: ing.name,
          catalogId: ing.catalogId ?? null,
          qty: 0,
        };
        cur.qty += ing.qty * batches;
        cur.catalogId = cur.catalogId || ing.catalogId || null;
        demand.set(k, cur);
      }
    }

    // 2. build one node per unique top-level resource against ONE shared pool
    const pool = this.makePool();
    const tree: CostNode[] = [];
    for (const d of demand.values()) {
      tree.push(this.buildNode(d.name, d.catalogId, d.qty, d.qty, new Set(), 0, pool));
    }
    // ordering: recipes + parts, then resources, then crystals/gemstones
    // (nested children keep their recipe order)
    tree.sort(byTypeThenNeed);
    const rollup = CraftCostCalc.rollup(tree);
    const shortfall = rollup.filter((n) => n.effShort > 0).slice().sort(byTypeThenNeed);
    return { tree, rollup, shortfall };
  }

  /** total still-short units for making `units` finished items of one recipe */
  private shortForUnits(recipe: CraftRecipe, units: number): number {
    const pool = this.makePool();
    const batches = Math.max(1, Math.ceil(units / (recipe.outputQty || 1)));
    let short = 0;
    const need = (
      name: string,
      catalogId: string | null,
      qty: number,
      path: Set<string>,
      depth: number,
    ) => {
      if (qty <= 0) return;
      const entry = this.resolve(name, catalogId);
      const got = this.drawFromPool(pool, entry, name, qty);
      const remaining = qty - got;
      if (remaining <= 0) return;
      const sub =
        entry?.craftable && depth < MAX_DEPTH && !path.has(entry.id)
          ? pickRecipe(entry)
          : null;
      if (entry && sub) {
        const b = Math.max(1, Math.ceil(remaining / (sub.outputQty || 1)));
        const nextPath = new Set(path).add(entry.id);
        for (const ing of sub.ingredients) {
          need(ing.name, ing.catalogId, ing.qty * b, nextPath, depth + 1);
        }
        return;
      }
      short += remaining;
    };
    for (const ing of recipe.ingredients) {
      need(ing.name, ing.catalogId, ing.qty * batches, new Set(), 0);
    }
    return short;
  }

  /** how many finished units of `recipe` we can make right now, docraft included */
  maxCraftable(recipe: CraftRecipe): number {
    const out = recipe.outputQty || 1;
    if (this.shortForUnits(recipe, out) > 0) return 0;
    let lo = out;
    let hi = out;
    const CAP = 1_000_000;
    while (hi < CAP && this.shortForUnits(recipe, hi * 2) === 0) hi *= 2;
    hi = Math.min(CAP, hi * 2);
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (this.shortForUnits(recipe, mid) === 0) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}
