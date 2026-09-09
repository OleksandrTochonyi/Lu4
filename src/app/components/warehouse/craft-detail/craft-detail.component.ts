import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { TooltipModule } from 'primeng/tooltip';

import { GradeBadgeComponent } from '../../shared/grade-badge/grade-badge.component';
import {
  CraftEntry,
  CraftRecipe,
  buildNameIndex,
  normName,
} from '../../../services/craft-catalog.service';
import { StockItem } from '../../../services/warehouse.service';

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
  /** how many units this branch needs (already scaled by the parent) */
  need: number;
  /**
   * units of the clan stock ACTUALLY allocated to this line. The whole tree
   * draws from one shared pool consumed in recipe order, so a resource used in
   * several branches is never counted twice — a later branch sees only what's
   * left (possibly 0).
   */
  have: number;
  /** max(0, need - have) — the gap this line still has after its stock allocation */
  missing: number;
  /**
   * units still unobtainable after crafting intermediates. Leaf: == missing.
   * Composite: sum of the children's effShort.
   */
  effShort: number;
  /**
   * covered  — the stock pool fully covered this line
   * craftable — not covered directly, but the sub-craft's resources cover it
   * short    — even the base resources fall short
   */
  status: 'covered' | 'craftable' | 'short';
  craftable: boolean;
  children: CostNode[];
}

/** a mutable copy of the clan stock, drawn down as the cost tree is evaluated */
interface StockPool {
  byCat: Map<string, number>;
  byNm: Map<string, number>;
}

const MAX_DEPTH = 8;

@Component({
  selector: 'app-craft-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    TooltipModule,
    GradeBadgeComponent,
  ],
  templateUrl: './craft-detail.component.html',
  styleUrl: './craft-detail.component.scss',
})
export class CraftDetailComponent {
  readonly entry = input.required<CraftEntry>();
  readonly allEntries = input.required<CraftEntry[]>();
  readonly stock = input.required<StockItem[]>();

  readonly requestClose = output<void>();

  readonly craftQty = signal(1);
  readonly recipeIndex = signal(0);
  /** recursively expand shortages down to base resources */
  readonly deep = signal(false);
  /**
   * per-row expand override, keyed by node key. Absent → use the default
   * (a composite row is open unless it is fully covered by the stock).
   */
  readonly rowOpen = signal<Map<string, boolean>>(new Map());

  private readonly byId = computed(() => new Map(this.allEntries().map((e) => [e.id, e])));
  private readonly byName = computed(() => buildNameIndex(this.allEntries()));

  /** stock qty keyed by catalogId and by normalized name */
  private readonly stockIndex = computed(() => {
    const byCat = new Map<string, number>();
    const byNm = new Map<string, number>();
    for (const s of this.stock()) {
      if (s.catalogId) byCat.set(s.catalogId, (byCat.get(s.catalogId) ?? 0) + s.qty);
      const n = normName(s.name);
      if (n) byNm.set(n, (byNm.get(n) ?? 0) + s.qty);
    }
    return { byCat, byNm };
  });

  readonly recipes = computed<CraftRecipe[]>(() => this.entry().recipes ?? []);

  readonly recipeOptions = computed(() =>
    this.recipes().map((r, i) => ({
      value: i,
      label:
        r.source === 'material'
          ? 'Материал / сборка'
          : `Рецепт${r.chance ? ' ' + r.chance : ''}`,
    })),
  );

  readonly recipe = computed<CraftRecipe | null>(() => {
    const list = this.recipes();
    if (!list.length) return null;
    return list[Math.min(this.recipeIndex(), list.length - 1)] ?? null;
  });

  private resolve(name: string, catalogId: string | null): CraftEntry | undefined {
    if (catalogId) {
      const hit = this.byId().get(catalogId);
      if (hit) return hit;
    }
    return this.byName().get(normName(name));
  }

  /** best recipe for expansion: prefer a material/sub-assembly, then highest chance */
  private pickRecipe(entry: CraftEntry): CraftRecipe | null {
    if (!entry.recipes.length) return null;
    const mat = entry.recipes.find((r) => r.source === 'material');
    if (mat) return mat;
    return [...entry.recipes].sort(
      (a, b) => (parseInt(b.chance) || 0) - (parseInt(a.chance) || 0),
    )[0];
  }

  /** fresh mutable copy of the clan stock */
  private makePool(): StockPool {
    const { byCat, byNm } = this.stockIndex();
    return { byCat: new Map(byCat), byNm: new Map(byNm) };
  }

  /**
   * Take up to `want` units of a resource out of the shared pool and return how
   * many were actually available (mirrors the catalogId-then-name lookup the old
   * `haveFor` used). Decrements the pool so the same stock can't be handed to
   * two different branches of one recipe.
   */
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
    need: number,
    path: Set<string>,
    depth: number,
    pool: StockPool,
  ): CostNode {
    const entry = this.resolve(name, catalogId);
    const craftable = !!entry?.craftable;
    const resKey = entry?.id ?? normName(name);
    const key = resKey + '@' + depth + ':' + name;

    const sub =
      entry && craftable && depth < MAX_DEPTH && !path.has(entry.id)
        ? this.pickRecipe(entry)
        : null;

    if (sub && entry) {
      // Composite — ALWAYS expand to its full recipe (a raw bill of materials;
      // finished-intermediate stock is not credited here — that's `canCraftNow`'s
      // job). The row's own have/missing roll up from its raw leaves.
      const batches = Math.max(1, Math.ceil(need / (sub.outputQty || 1)));
      const nextPath = new Set(path).add(entry.id);
      const children = sub.ingredients.map((ing) =>
        this.buildNode(ing.name, ing.catalogId, ing.qty * batches, nextPath, depth + 1, pool),
      );
      const effShort = children.reduce((s, c) => s + c.effShort, 0);
      const status: CostNode['status'] =
        effShort === 0
          ? 'covered'
          : children.some((c) => c.status !== 'short')
            ? 'craftable'
            : 'short';
      return {
        key,
        resKey,
        name: entry.name ?? name,
        icon: entry.icon,
        grade: entry.grade ?? null,
        category: entry.category ?? null,
        need,
        have: Math.max(0, need - effShort),
        missing: effShort,
        effShort,
        status,
        craftable,
        children,
      };
    }

    // Raw leaf — draw its stock from the shared pool, so a resource used in
    // several branches is allocated once, not shown as fully available everywhere.
    const have = this.drawFromPool(pool, entry, name, need);
    const missing = Math.max(0, need - have);
    return {
      key,
      resKey,
      name: entry?.name ?? name,
      icon: entry?.icon,
      grade: entry?.grade ?? null,
      category: entry?.category ?? null,
      need,
      have,
      missing,
      effShort: missing,
      status: missing === 0 ? 'covered' : 'short',
      craftable,
      children: [],
    };
  }

  readonly tree = computed<CostNode[]>(() => {
    const r = this.recipe();
    if (!r) return [];
    const qty = Math.max(1, Math.round(this.craftQty() || 1));
    const batches = Math.max(1, Math.ceil(qty / (r.outputQty || 1)));
    const pool = this.makePool();
    return r.ingredients.map((ing) =>
      this.buildNode(ing.name, ing.catalogId, ing.qty * batches, new Set(), 0, pool),
    );
  });

  /** a row that is itself crafted from sub-parts */
  isComposite(n: CostNode): boolean {
    return n.craftable && n.children.length > 0;
  }

  /** open by default unless the row is fully covered by the stock */
  isExpanded(n: CostNode): boolean {
    const o = this.rowOpen().get(n.key);
    return o === undefined ? n.status !== 'covered' : o;
  }

  toggleRow(n: CostNode): void {
    const next = new Map(this.rowOpen());
    next.set(n.key, !this.isExpanded(n));
    this.rowOpen.set(next);
  }

  /** total clan stock of one resource (by catalogId, else normalized name) */
  private stockFor(entry: CraftEntry | undefined, name: string): number {
    const { byCat, byNm } = this.stockIndex();
    if (entry && byCat.has(entry.id)) return byCat.get(entry.id) ?? 0;
    return byNm.get(normName(name)) ?? 0;
  }

  /**
   * Full bill of materials: recurse through EVERY craftable down to raw
   * resources (intermediate-item stock is deliberately ignored here — that's
   * what the tree view accounts for), sum each base resource across every place
   * it appears, then subtract that resource's stock ONCE. So a resource used in
   * several sub-recipes is fully counted, and never double-charged for stock.
   * Drives both the "Полный список базовых ресурсов" table and the
   * "Докупить / нафармить" chips.
   */
  readonly rollup = computed<CostNode[]>(() => {
    const r = this.recipe();
    if (!r) return [];
    const qty = Math.max(1, Math.round(this.craftQty() || 1));
    const rootBatches = Math.max(1, Math.ceil(qty / (r.outputQty || 1)));

    const acc = new Map<
      string,
      {
        name: string;
        icon?: string;
        grade: string | null;
        category: string | null;
        need: number;
        entry: CraftEntry | undefined;
      }
    >();

    const walk = (
      name: string,
      catalogId: string | null,
      need: number,
      path: Set<string>,
      depth: number,
    ) => {
      if (need <= 0) return;
      const entry = this.resolve(name, catalogId);
      const sub =
        entry && entry.craftable && depth < MAX_DEPTH && !path.has(entry.id)
          ? this.pickRecipe(entry)
          : null;
      if (entry && sub) {
        const b = Math.max(1, Math.ceil(need / (sub.outputQty || 1)));
        const nextPath = new Set(path).add(entry.id);
        for (const ing of sub.ingredients) {
          walk(ing.name, ing.catalogId, ing.qty * b, nextPath, depth + 1);
        }
        return;
      }
      const k = entry?.id ?? normName(name);
      const cur =
        acc.get(k) ??
        {
          name: entry?.name ?? name,
          icon: entry?.icon,
          grade: entry?.grade ?? null,
          category: entry?.category ?? null,
          need: 0,
          entry,
        };
      cur.need += need;
      acc.set(k, cur);
    };

    for (const ing of r.ingredients) {
      walk(ing.name, ing.catalogId, ing.qty * rootBatches, new Set(), 0);
    }

    return [...acc.entries()]
      .map(([k, v]) => {
        const have = this.stockFor(v.entry, v.name);
        const missing = Math.max(0, v.need - have);
        return {
          key: k,
          resKey: k,
          name: v.name,
          icon: v.icon,
          grade: v.grade,
          category: v.category,
          need: v.need,
          have,
          missing,
          effShort: missing,
          status: missing === 0 ? 'covered' : 'short',
          craftable: false,
          children: [] as CostNode[],
        } satisfies CostNode;
      })
      .sort(
        (a, b) => Number(b.missing > 0) - Number(a.missing > 0) || a.name.localeCompare(b.name),
      );
  });

  /** total shortfall (units) if we tried to make `units` finished items now */
  private shortForUnits(units: number): number {
    const r = this.recipe();
    if (!r) return 0;
    const pool = this.makePool();
    const batches = Math.max(1, Math.ceil(units / (r.outputQty || 1)));
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
          ? this.pickRecipe(entry)
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
    for (const ing of r.ingredients) {
      need(ing.name, ing.catalogId, ing.qty * batches, new Set(), 0);
    }
    return short;
  }

  /** how many finished units we can make right now — intermediate crafting included */
  readonly canCraftNow = computed(() => {
    const r = this.recipe();
    if (!r) return 0;
    const out = r.outputQty || 1;
    if (this.shortForUnits(out) > 0) return 0;
    // exponential probe for an upper bound, then binary-search the exact max
    let lo = out;
    let hi = out;
    const CAP = 1_000_000;
    while (hi < CAP && this.shortForUnits(hi * 2) === 0) hi *= 2;
    hi = Math.min(CAP, hi * 2);
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (this.shortForUnits(mid) === 0) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  });

  /** the base resources you still have to buy / farm — the shortfall rows of the
   *  full BoM, name-sorted for the chip list */
  readonly shortfall = computed<CostNode[]>(() =>
    this.rollup()
      .filter((n) => n.missing > 0)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  readonly rollupShortages = computed(() => this.rollup().filter((n) => n.missing > 0));

  readonly fullyStocked = computed(() => this.rollupShortages().length === 0);

  /** top-level ingredients that need an intermediate craft (have some, but coverable) */
  readonly needsSubcraft = computed(() =>
    this.tree().some((n) => n.status === 'craftable'),
  );

  setRecipe(i: number): void {
    this.recipeIndex.set(i);
    this.rowOpen.set(new Map());
  }

  expandAll(): void {
    const map = new Map<string, boolean>();
    const walk = (n: CostNode) => {
      if (this.isComposite(n)) map.set(n.key, true);
      n.children.forEach(walk);
    };
    this.tree().forEach(walk);
    this.rowOpen.set(map);
  }
  collapseAll(): void {
    const map = new Map<string, boolean>();
    const walk = (n: CostNode) => {
      if (this.isComposite(n)) map.set(n.key, false);
      n.children.forEach(walk);
    };
    this.tree().forEach(walk);
    this.rowOpen.set(map);
  }

  /** grade is only meaningful for gear (armor / weapon / jewelry) */
  showGrade(category: string | null | undefined): boolean {
    return category === 'weapon' || category === 'armor' || category === 'jewelry';
  }

  close(): void {
    this.requestClose.emit();
  }

  onVisibleChange(visible: boolean): void {
    if (!visible) this.close();
  }

  imgError(e: Event): void {
    const el = e.target as HTMLImageElement | null;
    if (el) el.style.visibility = 'hidden';
  }

  trackNode = (_: number, n: CostNode) => n.key;
}
