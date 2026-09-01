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
  key: string;
  name: string;
  icon?: string;
  grade: string | null;
  category: string | null;
  /** how many units this branch needs (already scaled by the parent) */
  need: number;
  /** units on the clan stock */
  have: number;
  /** max(0, need - have) — the raw gap, before considering sub-crafting */
  missing: number;
  /** how many units we can actually obtain (stock + crafting sub-parts from stock) */
  producible: number;
  /** units we still cannot get even after crafting intermediates — max(0, need - producible) */
  effShort: number;
  /**
   * covered  — enough already on the stock
   * craftable — not on the stock, but base resources cover the sub-craft
   * short    — even the base resources fall short
   */
  status: 'covered' | 'craftable' | 'short';
  craftable: boolean;
  children: CostNode[];
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

  private haveFor(entry: CraftEntry | undefined, name: string): number {
    const { byCat, byNm } = this.stockIndex();
    if (entry && byCat.has(entry.id)) return byCat.get(entry.id) ?? 0;
    return byNm.get(normName(name)) ?? 0;
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

  /**
   * How many units of `entry` we can actually obtain to satisfy `want`:
   * whatever is on the stock, plus — if it is craftable — as many as the
   * (recursively resolved) sub-ingredients on the stock allow. Capped at `want`.
   * Note: each branch sees the full stock independently, so a base resource
   * shared by several branches is not double-charged here — the flat
   * "полный список" view is the exact aggregate.
   */
  private producible(
    entry: CraftEntry | undefined,
    name: string,
    want: number,
    path: Set<string>,
  ): number {
    if (want <= 0) return 0;
    const have = this.haveFor(entry, name);
    const fromStock = Math.min(want, have);
    const remaining = want - fromStock;
    if (remaining <= 0) return want;
    if (!entry?.craftable || path.has(entry.id) || path.size >= MAX_DEPTH) return fromStock;

    const r = this.pickRecipe(entry);
    if (!r) return fromStock;

    const batches = Math.ceil(remaining / (r.outputQty || 1));
    const nextPath = new Set(path).add(entry.id);
    let maxBatches = batches;
    for (const ing of r.ingredients) {
      if (ing.qty <= 0) continue;
      const sub = this.resolve(ing.name, ing.catalogId);
      const got = this.producible(sub, ing.name, ing.qty * batches, nextPath);
      maxBatches = Math.min(maxBatches, Math.floor(got / ing.qty));
    }
    return fromStock + Math.min(remaining, Math.max(0, maxBatches) * (r.outputQty || 1));
  }

  private buildNode(
    name: string,
    catalogId: string | null,
    need: number,
    path: Set<string>,
    depth: number,
  ): CostNode {
    const entry = this.resolve(name, catalogId);
    const have = this.haveFor(entry, name);
    const missing = Math.max(0, need - have);
    const craftable = !!entry?.craftable;
    const key = (entry?.id ?? normName(name)) + '@' + depth + ':' + name;

    const producible = this.producible(entry, name, need, path);
    const effShort = Math.max(0, need - producible);
    const status: CostNode['status'] =
      missing === 0 ? 'covered' : effShort === 0 ? 'craftable' : 'short';

    const node: CostNode = {
      key,
      name: entry?.name ?? name,
      icon: entry?.icon,
      grade: entry?.grade ?? null,
      category: entry?.category ?? null,
      need,
      have,
      missing,
      producible,
      effShort,
      status,
      craftable,
      children: [],
    };

    // always resolve the sub-tree (so the summary / shopping list stay correct
    // regardless of what is collapsed); the template just hides collapsed rows
    if (entry && craftable && depth < MAX_DEPTH && !path.has(entry.id)) {
      const sub = this.pickRecipe(entry);
      if (sub) {
        const batches = Math.max(1, Math.ceil((missing || need) / (sub.outputQty || 1)));
        const nextPath = new Set(path).add(entry.id);
        node.children = sub.ingredients.map((ing) =>
          this.buildNode(ing.name, ing.catalogId, ing.qty * batches, nextPath, depth + 1),
        );
      }
    }
    return node;
  }

  readonly tree = computed<CostNode[]>(() => {
    const r = this.recipe();
    if (!r) return [];
    const qty = Math.max(1, Math.round(this.craftQty() || 1));
    const batches = Math.max(1, Math.ceil(qty / (r.outputQty || 1)));
    return r.ingredients.map((ing) =>
      this.buildNode(ing.name, ing.catalogId, ing.qty * batches, new Set(), 0),
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

  /** flat roll-up of the leaf resources (used for the summary + "shopping list") */
  readonly rollup = computed(() => {
    const r = this.recipe();
    if (!r) return [] as CostNode[];
    const qty = Math.max(1, Math.round(this.craftQty() || 1));
    const batches = Math.max(1, Math.ceil(qty / (r.outputQty || 1)));
    const acc = new Map<
      string,
      { name: string; icon?: string; grade: string | null; category: string | null; need: number }
    >();

    const walk = (name: string, catalogId: string | null, need: number, path: Set<string>, depth: number) => {
      const entry = this.resolve(name, catalogId);
      const sub = entry && entry.craftable && depth < MAX_DEPTH && !path.has(entry.id)
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
      const key = entry?.id ?? normName(name);
      const cur = acc.get(key) ?? {
        name: entry?.name ?? name,
        icon: entry?.icon,
        grade: entry?.grade ?? null,
        category: entry?.category ?? null,
        need: 0,
      };
      cur.need += need;
      acc.set(key, cur);
    };

    for (const ing of r.ingredients) {
      walk(ing.name, ing.catalogId, ing.qty * batches, new Set(), 0);
    }

    return [...acc.entries()].map(([key, v]) => {
      const entry = this.byId().get(key);
      const have = this.haveFor(entry, v.name);
      const missing = Math.max(0, v.need - have);
      return {
        key,
        name: v.name,
        icon: v.icon,
        grade: v.grade,
        category: v.category,
        need: v.need,
        have,
        missing,
        producible: Math.min(v.need, have),
        effShort: missing,
        status: missing === 0 ? 'covered' : 'short',
        craftable: false,
        children: [] as CostNode[],
      } satisfies CostNode;
    }).sort((a, b) => Number(b.missing > 0) - Number(a.missing > 0) || a.name.localeCompare(b.name));
  });

  /** how many finished units we can make now — counting intermediate crafting from stock */
  readonly canCraftNow = computed(() => {
    const r = this.recipe();
    if (!r) return 0;
    let min = Infinity;
    for (const ing of r.ingredients) {
      if (ing.qty <= 0) continue;
      const entry = this.resolve(ing.name, ing.catalogId);
      const got = this.producible(entry, ing.name, ing.qty * 1_000_000, new Set());
      min = Math.min(min, Math.floor(got / ing.qty));
    }
    if (!Number.isFinite(min)) return 0;
    return min * (r.outputQty || 1);
  });

  /** flatten the tree to the leaves that are genuinely short (base resources to buy/farm) */
  readonly shortfall = computed<CostNode[]>(() => {
    const acc = new Map<string, CostNode>();
    const walk = (n: CostNode) => {
      if (n.children.length) {
        n.children.forEach(walk);
        return;
      }
      if (n.effShort > 0) {
        const cur = acc.get(n.name);
        if (cur) cur.effShort += n.effShort;
        else acc.set(n.name, { ...n, need: n.effShort });
      }
    };
    this.tree().forEach(walk);
    return [...acc.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly rollupShortages = computed(() => this.rollup().filter((n) => n.missing > 0));

  readonly fullyStocked = computed(() =>
    this.deep() ? this.rollupShortages().length === 0 : this.shortfall().length === 0,
  );

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
