import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { timer } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { PopoverModule } from 'primeng/popover';
import { MessageService } from 'primeng/api';

import { JsonRb, RbJsonDataService } from '../../services/rb-json-data.service';
import { RbJsonRespService } from '../../services/rb-json-resp.service';
import { JsonRbCardComponent } from '../shared/json-rb-card/json-rb-card.component';
import { getRbKey, readHiddenIds, writeHiddenIds } from '../../utils/rb-hidden';
import { enrichJsonRb } from '../../utils/rb-json-enrich';
import { calculateStatus } from '../../utils/rb-enrich';
import { RbStatus } from '../../constants/status';

// Catalog page: raid bosses come from assets/data/db.json, kill time from the
// rb-resp-time collection (this catalog's own store, see RbJsonRespService) — resp
// windows/status are computed with the exact same formula as the old Home page
// (utils/rb-enrich.ts, via the enrichJsonRb adapter) so behavior matches.
@Component({
  selector: 'app-home-new',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    CheckboxModule,
    InputNumberModule,
    InputTextModule,
    PopoverModule,
    JsonRbCardComponent,
  ],
  templateUrl: './home-new.component.html',
  styleUrl: './home-new.component.scss',
})
export class HomeNewComponent {
  private destroyRef = inject(DestroyRef);
  private rbJsonData = inject(RbJsonDataService);
  private rbJsonResp = inject(RbJsonRespService);
  private messageService = inject(MessageService);

  private readonly LS_LEVEL_FROM = 'rb-new-filter-level-from';
  private readonly LS_LEVEL_TO = 'rb-new-filter-level-to';

  items = signal<any[]>([]);
  loading = signal(true);

  nameQuery = signal('');
  levelFrom = signal<number | null>(this.readStoredLevel(this.LS_LEVEL_FROM));
  levelTo = signal<number | null>(this.readStoredLevel(this.LS_LEVEL_TO));

  showOnlyResp = signal(false);
  showOneHourToResp = signal(false);
  showHidden = signal(false);
  onlyHidden = signal(false);
  hiddenIds = signal<Set<string>>(readHiddenIds());
  // Ticks every second so the resp filters below recompute each boss's status live
  // (against its fixed resp-window Dates) instead of a stale `.status` snapshot.
  private now = signal(Date.now());

  get nameQueryValue(): string {
    return this.nameQuery();
  }
  set nameQueryValue(value: string) {
    this.nameQuery.set(value ?? '');
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

  resetLevelFilters(): void {
    this.levelFromValue = null;
    this.levelToValue = null;
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

  visibleItems = computed(() => {
    const items = this.items() ?? [];
    const now = this.now();
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

        if (query && !String(item.displayName ?? '').toLowerCase().includes(query)) return false;

        const level = Number(item.lvl ?? 0);
        if (from != null && level < from) return false;
        if (to != null && level > to) return false;

        if (!onlyResp && !oneHour) return true;

        const status = calculateStatus(item?.minResp ?? null, item?.maxResp ?? null, item?.secondMinResp ?? null, item?.secondMaxResp ?? null, now);
        const inResp = status === RbStatus.InResp || status === RbStatus.SecondResp;

        const minMs = item?.minResp instanceof Date ? item.minResp.getTime() : null;
        const secondMinMs = item?.secondMinResp instanceof Date ? item.secondMinResp.getTime() : null;
        const inOneHourToFirst = minMs != null && minMs > now && minMs - now <= hourMs;
        const inOneHourToSecond = secondMinMs != null && secondMinMs > now && secondMinMs - now <= hourMs;
        const inOneHourToResp = inOneHourToFirst || inOneHourToSecond;

        if (onlyResp && oneHour) return inResp || inOneHourToResp;
        if (onlyResp) return inResp;
        return inOneHourToResp;
      })
      .sort((a, b) => Number(a.lvl ?? 0) - Number(b.lvl ?? 0));
  });

  constructor() {
    this.rbJsonData
      .getRaidBosses()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => {
          this.items.set((items ?? []).map((item) => enrichJsonRb(item)));
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });

    timer(0, 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));
  }

  onDeadTimeDraftChanged(event: { rb: any; deadTime: Date | null }): void {
    const rbId = event.rb?.id;
    this.items.update((items) =>
      (items ?? []).map((item) =>
        item?.id === rbId ? enrichJsonRb({ ...item, lastDeadTime: event.deadTime }) : item
      )
    );
  }

  onDeadTimeChanged(event: { rb: any; deadTime: Date | null }): void {
    const rbId = event.rb?.id;
    if (!rbId) return;

    this.rbJsonResp
      .setKillTime(rbId, event.deadTime)
      .then(() => {
        this.messageService.add({ severity: 'success', summary: 'Время сохранено', life: 2500 });
      })
      .catch((err) => console.error('Failed to set kill time:', err));

    this.items.update((items) =>
      (items ?? []).map((item) =>
        item?.id === rbId ? enrichJsonRb({ ...item, lastDeadTime: event.deadTime }) : item
      )
    );
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
}
