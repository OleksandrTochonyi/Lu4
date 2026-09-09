import { CommonModule } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { GradeBadgeComponent } from '../grade-badge/grade-badge.component';
import { CostNode } from '../../../utils/craft-cost';

/**
 * Flat "how much does this cost" table + a "buy / farm" chip list. Fed a
 * `rollup` (one row per resource, already aggregated) from `CraftCostCalc`.
 * Shared by the craft-detail dialog's deep view and the warehouse craft plan.
 */
@Component({
  selector: 'app-cost-table',
  standalone: true,
  imports: [CommonModule, TooltipModule, GradeBadgeComponent],
  templateUrl: './cost-table.component.html',
  styleUrl: './cost-table.component.scss',
})
export class CostTableComponent {
  readonly rows = input.required<CostNode[]>();

  // `rows` already comes ordered (recipes/parts → resources → crystals);
  // keep that order for the chips too
  readonly shortfall = computed(() => this.rows().filter((n) => n.effShort > 0));

  readonly allCovered = computed(() => this.shortfall().length === 0);

  showGrade(category: string | null | undefined): boolean {
    return category === 'weapon' || category === 'armor' || category === 'jewelry';
  }

  imgError(e: Event): void {
    const el = e.target as HTMLImageElement | null;
    if (el) el.style.visibility = 'hidden';
  }

  trackNode = (_: number, n: CostNode) => n.key;
}
