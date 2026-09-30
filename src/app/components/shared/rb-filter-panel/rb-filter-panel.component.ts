import { Component, computed, input } from '@angular/core';

import {
  RB_FILTER_GROUPS,
  RB_FILTER_PRESETS,
  RbFilterGroup,
  RbFilterItem,
  RbFilterSort,
  RbFilterState,
} from '../../../utils/rb-filter';

/** contents of the bookmark pages' «Фильтры» popover */
@Component({
  selector: 'app-rb-filter-panel',
  standalone: true,
  templateUrl: './rb-filter-panel.component.html',
  styleUrl: './rb-filter-panel.component.scss',
})
export class RbFilterPanelComponent {
  readonly state = input.required<RbFilterState>();
  /** the open bookmark's bosses — only for the per-status counts */
  readonly items = input<RbFilterItem[]>([]);
  readonly now = input<number>(Date.now());

  readonly groups = RB_FILTER_GROUPS;
  readonly presets = RB_FILTER_PRESETS;
  readonly sorts: { key: RbFilterSort; label: string }[] = [
    { key: 'level', label: 'По уровню' },
    { key: 'resp', label: 'Ближе к респу' },
    { key: 'name', label: 'По имени' },
  ];

  readonly counts = computed(() => {
    const st = this.state();
    const now = this.now();
    const c: Record<string, number> = {};
    for (const it of this.items()) for (const g of st.groupsOf(it, now)) c[g] = (c[g] ?? 0) + 1;
    return c;
  });

  countOf(g: RbFilterGroup): number {
    return this.counts()[g] ?? 0;
  }

  onLevel(which: 'from' | 'to', e: Event): void {
    const raw = (e.target as HTMLInputElement).value.trim();
    const n = raw === '' ? null : Math.max(1, Math.round(Number(raw)));
    const v = n != null && Number.isFinite(n) ? n : null;
    const st = this.state();
    if (which === 'from') st.setLevel(v, st.lvlTo());
    else st.setLevel(st.lvlFrom(), v);
  }

  onSearch(e: Event): void {
    this.state().search.set((e.target as HTMLInputElement).value);
  }
}
