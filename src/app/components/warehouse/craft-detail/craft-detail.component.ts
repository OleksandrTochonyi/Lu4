import { CommonModule } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { TooltipModule } from 'primeng/tooltip';

import { GradeBadgeComponent } from '../../shared/grade-badge/grade-badge.component';
import { CraftEntry, CraftRecipe } from '../../../services/craft-catalog.service';
import { StockItem } from '../../../services/warehouse.service';
import { CostNode, CostPlan, CraftCostCalc, recipeLabel } from '../../../utils/craft-cost';

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

  readonly recipes = computed<CraftRecipe[]>(() => this.entry().recipes ?? []);

  readonly recipeOptions = computed(() =>
    this.recipes().map((r, i) => ({ value: i, label: recipeLabel(r) })),
  );

  readonly recipe = computed<CraftRecipe | null>(() => {
    const list = this.recipes();
    if (!list.length) return null;
    return list[Math.min(this.recipeIndex(), list.length - 1)] ?? null;
  });

  private readonly calc = computed(() => new CraftCostCalc(this.allEntries(), this.stock()));

  private readonly plan = computed<CostPlan>(() => {
    const r = this.recipe();
    if (!r) return { tree: [], rollup: [], shortfall: [] };
    return this.calc().computePlan([
      { recipe: r, qty: Math.max(1, Math.round(this.craftQty() || 1)) },
    ]);
  });

  readonly tree = computed(() => this.plan().tree);
  readonly rollup = computed(() => this.plan().rollup);
  readonly shortfall = computed(() => this.plan().shortfall);
  readonly rollupShortages = computed(() => this.rollup().filter((n) => n.effShort > 0));
  readonly fullyStocked = computed(() => this.rollupShortages().length === 0);
  readonly needsSubcraft = computed(() => this.tree().some((n) => n.status === 'craftable'));

  readonly canCraftNow = computed(() => {
    const r = this.recipe();
    return r ? this.calc().maxCraftable(r) : 0;
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
