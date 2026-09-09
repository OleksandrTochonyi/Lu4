import { CommonModule } from '@angular/common';
import { Component, input, signal } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { GradeBadgeComponent } from '../grade-badge/grade-badge.component';
import { CostNode } from '../../../utils/craft-cost';

/**
 * The recursive "what does this cost" tree — expandable composites, grade
 * badges, per-row Всего / Нужно / Есть / Не хватает + a "Докупить / нафармить"
 * chip list. Fed a `CostPlan.tree` (+ its `shortfall`) from `CraftCostCalc`.
 */
@Component({
  selector: 'app-cost-tree',
  standalone: true,
  imports: [CommonModule, TooltipModule, GradeBadgeComponent],
  templateUrl: './cost-tree.component.html',
  styleUrl: './cost-tree.component.scss',
})
export class CostTreeComponent {
  readonly tree = input.required<CostNode[]>();
  readonly shortfall = input<CostNode[]>([]);

  readonly rowOpen = signal<Map<string, boolean>>(new Map());

  isComposite(n: CostNode): boolean {
    return n.craftable && n.children.length > 0;
  }
  isExpanded(n: CostNode): boolean {
    const o = this.rowOpen().get(n.key);
    return o === undefined ? n.status !== 'covered' : o;
  }
  toggleRow(n: CostNode): void {
    const next = new Map(this.rowOpen());
    next.set(n.key, !this.isExpanded(n));
    this.rowOpen.set(next);
  }
  expandAll(): void {
    this.setAll(true);
  }
  collapseAll(): void {
    this.setAll(false);
  }
  private setAll(open: boolean): void {
    const map = new Map<string, boolean>();
    const walk = (n: CostNode) => {
      if (this.isComposite(n)) map.set(n.key, open);
      n.children.forEach(walk);
    };
    this.tree().forEach(walk);
    this.rowOpen.set(map);
  }

  showGrade(category: string | null | undefined): boolean {
    return category === 'weapon' || category === 'armor' || category === 'jewelry';
  }

  imgError(e: Event): void {
    const el = e.target as HTMLImageElement | null;
    if (el) el.style.visibility = 'hidden';
  }

  trackNode = (_: number, n: CostNode) => n.key;
}
