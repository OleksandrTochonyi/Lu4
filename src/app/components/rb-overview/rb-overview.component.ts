import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Timestamp } from 'firebase/firestore';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputNumberModule } from 'primeng/inputnumber';
import { PopoverModule } from 'primeng/popover';
import { MessageService } from 'primeng/api';

import { RbData } from '../../services/rb-data';
import { RbStatus } from '../../constants/status';
import { RbListComponent } from './components/rb-list/rb-list.component';
import { RbGridComponent } from './components/rb-grid/rb-grid.component';
import { environment } from '../../environments/environment';
import { InputTextModule } from 'primeng/inputtext';
import { enrichRbItem } from '../../utils/rb-enrich';
import { getRbKey, readHiddenIds, writeHiddenIds } from '../../utils/rb-hidden';

@Component({
  selector: 'app-rb-overview',
  imports: [
    RbListComponent,
    RbGridComponent,
    FormsModule,
    ButtonModule,
    CheckboxModule,
    InputNumberModule,
    InputTextModule,
    PopoverModule,
  ],
  templateUrl: './rb-overview.component.html',
  styleUrl: './rb-overview.component.scss'
})
export class RbOverviewComponent {
  private destroyRef = inject(DestroyRef);
  private rbDataService = inject(RbData);
  private messageService = inject(MessageService);

  private readonly LS_LEVEL_FROM = 'rb-filter-level-from';
  private readonly LS_LEVEL_TO = 'rb-filter-level-to';
  private readonly LS_VIEW_MODE = 'rb-view-mode';
  private readonly LS_COMPACT_VIEW = 'rb-compact-view';

  showTableView = signal(this.readStoredViewMode());
  compactView = signal(this.readStoredCompactView());

  items = signal<any[]>([]);

  showOnlyResp = signal(false);
  showOneHourToResp = signal(false);
  showHidden = signal(false);
  onlyHidden = signal(false);

  nameQuery = signal('');

  levelFrom = signal<number | null>(this.readStoredLevel(this.LS_LEVEL_FROM));
  levelTo = signal<number | null>(this.readStoredLevel(this.LS_LEVEL_TO));

  hiddenIds = signal<Set<string>>(readHiddenIds());

  get nameQueryValue(): string {
    return this.nameQuery();
  }

  set nameQueryValue(value: string) {
    this.nameQuery.set(value ?? '');
  }

  toggleView(): void {
    const next = !this.showTableView();
    this.showTableView.set(next);
    try {
      localStorage.setItem(this.LS_VIEW_MODE, next ? 'table' : 'list');
    } catch {
      // ignore storage errors
    }
  }

  resetLevelFilters(): void {
    this.levelFromValue = null;
    this.levelToValue = null;
  }

  private readStoredViewMode(): boolean {
    try {
      return localStorage.getItem(this.LS_VIEW_MODE) === 'table';
    } catch {
      return false;
    }
  }

  toggleCompact(): void {
    const next = !this.compactView();
    this.compactView.set(next);
    try {
      localStorage.setItem(this.LS_COMPACT_VIEW, next ? '1' : '0');
    } catch {
      // ignore storage errors
    }
  }

  private readStoredCompactView(): boolean {
    try {
      return localStorage.getItem(this.LS_COMPACT_VIEW) === '1';
    } catch {
      return false;
    }
  }

  get showOnlyRespValue(): boolean {
    return this.showOnlyResp();
  }

  set showOnlyRespValue(value: boolean) {
    this.showOnlyResp.set(value);
  }

  get showOneHourToRespValue(): boolean {
    return this.showOneHourToResp();
  }

  set showOneHourToRespValue(value: boolean) {
    this.showOneHourToResp.set(value);
  }

  get showHiddenValue(): boolean {
    return this.showHidden();
  }

  set showHiddenValue(value: boolean) {
    this.showHidden.set(value);
  }

  get onlyHiddenValue(): boolean {
    return this.onlyHidden();
  }

  set onlyHiddenValue(value: boolean) {
    this.onlyHidden.set(value);
  }

  isHidden(item: any): boolean {
    return this.hiddenIds().has(getRbKey(item));
  }

  toggleHidden(item: any): void {
    const key = getRbKey(item);
    if (!key) return;

    this.hiddenIds.update((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeHiddenIds(next);
      return next;
    });
  }

  get levelFromValue(): number | null {
    return this.levelFrom();
  }

  set levelFromValue(value: number | null) {
    this.levelFrom.set(value);
    this.writeStoredLevel(this.LS_LEVEL_FROM, value);
  }

  get levelToValue(): number | null {
    return this.levelTo();
  }

  set levelToValue(value: number | null) {
    this.levelTo.set(value);
    this.writeStoredLevel(this.LS_LEVEL_TO, value);
  }

  private readStoredLevel(key: string): number | null {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null || raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  private writeStoredLevel(key: string, value: number | null): void {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch {
      // ignore storage errors
    }
  }

  visibleItems = computed(() => {
    const items = this.items() ?? [];
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    const onlyResp = this.showOnlyResp();
    const oneHour = this.showOneHourToResp();
    const from = this.levelFrom();
    const to = this.levelTo();
    const query = this.nameQuery().trim().toLowerCase();
    const hiddenIds = this.hiddenIds();
    const showHidden = this.showHidden();
    const onlyHidden = this.onlyHidden();

    return items
      .map((item) => ({ ...item, hidden: hiddenIds.has(getRbKey(item)) }))
      .filter((item) => {
        if (onlyHidden) {
          if (!item.hidden) return false;
        } else if (item.hidden && !showHidden) {
          return false;
        }

        if (query) {
          const name = String(item?.displayName ?? item?.name ?? '').toLowerCase();
          if (!name.includes(query)) return false;
        }

        const level = Number(item?.lvl ?? item?.level ?? 0);
        if (from != null && level < from) return false;
        if (to != null && level > to) return false;

        if (!onlyResp && !oneHour) return true;

        const inResp = item?.status === RbStatus.InResp || item?.status === RbStatus.SecondResp;

        const minResp: Date | null = item?.minResp ?? null;
        const secondMinResp: Date | null = item?.secondMinResp ?? null;
        const minMs = minResp instanceof Date ? minResp.getTime() : null;
        const secondMinMs = secondMinResp instanceof Date ? secondMinResp.getTime() : null;
        const inOneHourToFirst = minMs != null && minMs > now && minMs - now <= hourMs;
        const inOneHourToSecond =
          secondMinMs != null && secondMinMs > now && secondMinMs - now <= hourMs;
        const inOneHourToResp = inOneHourToFirst || inOneHourToSecond;

        // If both toggles are enabled, treat them as OR.
        if (onlyResp && oneHour) return inResp || inOneHourToResp;
        if (onlyResp) return inResp;
        return inOneHourToResp;
      })
      .sort((a, b) => Number(a?.lvl ?? a?.level ?? 0) - Number(b?.lvl ?? b?.level ?? 0));
  });


  constructor() {
    this.rbDataService
      .getItems()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => {
        this.items.set((items ?? []).map((item) => enrichRbItem(item)));
      });

  }

  onDeadTimeDraftChanged(event: { rb: any; deadTime: Date | null }): void {
    const rbId = event.rb?.id;

    this.items.update((items) =>
      (items ?? []).map((item) => {
        if (rbId && item?.id !== rbId) return item;
        if (!rbId && item !== event.rb) return item;

        const lastDeadTime = event.deadTime ? Timestamp.fromDate(event.deadTime) : null;
        return enrichRbItem({ ...item, lastDeadTime });
      })
    );
  }

  onDeadTimeChanged(event: { rb: any; deadTime: Date | null }): void {
    const rbId = event.rb?.id;

    if (rbId) {
      this.rbDataService
        .setKillTime(rbId, event.deadTime)
        .then(() => {
          this.messageService.add({
            severity: 'success',
            summary: 'Как такой рак рб убивает??? Мамкин киллер..',
            detail: 'Ладно пох.. время сохранил',
            life: 3000,
          });
        })
        .catch((err) => console.error('Failed to set kill time:', err));
    }

    this.items.update((items) =>
      (items ?? []).map((item) => {
        if (rbId && item?.id !== rbId) return item;
        if (!rbId && item !== event.rb) return item;

        const lastDeadTime = event.deadTime ? Timestamp.fromDate(event.deadTime) : null;
        return enrichRbItem({ ...item, lastDeadTime });
      })
    );
  }

}
