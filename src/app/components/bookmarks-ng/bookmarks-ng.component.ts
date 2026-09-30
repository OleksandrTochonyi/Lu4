import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { timer } from 'rxjs';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { MultiSelectModule } from 'primeng/multiselect';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { TabsModule } from 'primeng/tabs';
import { PopoverModule } from 'primeng/popover';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

import { NoGradeRbService } from '../../services/nograde-rb.service';
import { ActivityLogService } from '../../services/activity-log.service';
import { RespVoiceService, RespVoiceWatcher } from '../../services/resp-voice.service';
import { enrichJsonRb } from '../../utils/rb-json-enrich';
import { calculateStatus } from '../../utils/rb-enrich';
import { CLEAR_STATUS_OPTIONS, RbStatus } from '../../constants/status';
import { JsonRbCardComponent } from '../shared/json-rb-card/json-rb-card.component';

interface CustomBossTab {
  id: string;
  name: string;
  rbIds: string[];
  hidden?: boolean;
}

// Copy of the Bookmarks page whose kill times come from the Lu4NoGrade Firebase project
// (NoGradeRbService) instead of ours. Bookmark tabs are their own localStorage set, so
// they never mix with the main page's. The onboarding tour, the map jump and the
// Telegram resp pings are deliberately left out — they belong to our own data.
@Component({
  selector: 'app-bookmarks-ng',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    MultiSelectModule,
    CheckboxModule,
    DialogModule,
    TabsModule,
    PopoverModule,
    TooltipModule,
    ConfirmDialogModule,
    DragDropModule,
    JsonRbCardComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './bookmarks-ng.component.html',
  styleUrl: './bookmarks-ng.component.scss',
})
export class BookmarksNgComponent {
  readonly voice = inject(RespVoiceService);
  private destroyRef = inject(DestroyRef);
  private noGradeRb = inject(NoGradeRbService);
  private activityLog = inject(ActivityLogService);
  private confirmationService = inject(ConfirmationService);
  private messageService = inject(MessageService);

  private readonly LS_TABS = 'rb-ng-custom-tabs';

  items = signal<any[]>([]);
  // Ticks every second so tabStatusCounts/activeTabItems recompute each boss's status
  // live (against its fixed resp-window Dates) instead of relying on the stale
  // `.status` snapshot that `items` only refreshes on the next Firestore emission.
  private now = signal(Date.now());

  tabs = signal<CustomBossTab[]>(this.readStoredTabs());
  activeTabId = signal<string>(this.tabs().find((t) => !t.hidden)?.id ?? '');

  visibleTabs = computed(() => this.tabs().filter((t) => !t.hidden));
  hiddenTabs = computed(() => this.tabs().filter((t) => t.hidden));

  activeTab = computed(() => this.tabs().find((t) => t.id === this.activeTabId()) ?? null);

  /** voice «РБ … в респе»: the open bookmark, or every visible one (panel switch) */
  private voiceWatcher = new RespVoiceWatcher(this.voice);
  private readonly voiceWatch = effect(() => {
    const now = this.now();
    if (!this.voice.enabled()) {
      this.voiceWatcher.check([], now); // drop baselines while muted
      return;
    }
    const active = this.activeTab();
    const tabs = this.voice.allTabs() ? this.visibleTabs() : active ? [active] : [];
    const ids = new Set(tabs.flatMap((t) => t.rbIds ?? []));
    this.voiceWatcher.check(
      this.items().filter((i) => ids.has(i?.id)),
      now,
    );
  });

  // create/rename bookmark dialog state
  tabDialogVisible = signal(false);
  tabDialogMode = signal<'create' | 'rename'>('create');
  tabNameDraft = signal('');
  tabHiddenDraft = signal(false);
  private editingTabId: string | null = null;

  pickerLevelFrom = signal<number | null>(null);
  pickerLevelTo = signal<number | null>(null);

  resetPickerLevelFilter(): void {
    this.pickerLevelFrom.set(null);
    this.pickerLevelTo.set(null);
  }

  showOnlyResp = signal(false);
  showOneHourToResp = signal(false);

  resetRespFilters(): void {
    this.showOnlyResp.set(false);
    this.showOneHourToResp.set(false);
  }

  rbOptions = computed(() => {
    return (this.items() ?? [])
      .filter((item) => item?.id)
      .slice()
      .sort(
        (a, b) =>
          Number(a?.lvl ?? 0) - Number(b?.lvl ?? 0) ||
          String(a?.displayName ?? '').localeCompare(String(b?.displayName ?? ''))
      )
      .map((item) => ({
        label: `[${item.lvl ?? '?'}] ${item.displayName ?? item.name}`,
        value: item.id,
        level: Number(item?.lvl ?? 0),
      }));
  });

  filteredRbOptions = computed(() => {
    const from = this.pickerLevelFrom();
    const to = this.pickerLevelTo();
    const options = this.rbOptions();
    if (from == null && to == null) return options;

    const matchesLevel =
      from != null && to != null
        ? (level: number) => level >= from && level <= to
        : from != null
          ? (level: number) => level === from
          : (level: number) => level === to;

    return options.filter((opt) => matchesLevel(opt.level));
  });

  // The "add all / remove all" toggle only makes sense once the picker list is
  // actually narrowed to a level range — bulk-adding the entire catalog isn't a
  // thing anyone wants. Requires both bounds ("от-до").
  levelRangeActive = computed(() => this.pickerLevelFrom() != null && this.pickerLevelTo() != null);

  // True when every RB currently visible in the picker (after the level filter) is
  // already in the active tab — drives the checkbox's checked state and its label
  // (all in → "Убрать все", otherwise → "Добавить все").
  allFilteredSelected = computed(() => {
    const tab = this.activeTab();
    if (!tab) return false;
    const filtered = this.filteredRbOptions();
    if (!filtered.length) return false;
    const idSet = new Set(tab.rbIds ?? []);
    return filtered.every((opt) => idSet.has(opt.value));
  });

  toggleAllFiltered(): void {
    const tab = this.activeTab();
    if (!tab) return;

    const filteredIds = this.filteredRbOptions().map((opt) => opt.value);
    if (!filteredIds.length) return;

    const current = new Set(tab.rbIds ?? []);
    const allSelected = filteredIds.every((id) => current.has(id));

    if (allSelected) {
      for (const id of filteredIds) current.delete(id);
    } else {
      for (const id of filteredIds) current.add(id);
    }

    this.updateTabRbIds(tab.id, [...current]);
  }

  // Red/yellow/green breakdown shown on each bookmark's header, alongside the total
  // count — mirrors the old Bookmarks page. Recomputed live off `this.now()` (see its
  // declaration) rather than each item's stale `.status` snapshot.
  tabStatusCounts = computed(() => {
    const byId = new Map<string, any>();
    for (const item of this.items()) {
      if (item?.id) byId.set(item.id, item);
    }

    const now = this.now();
    const result = new Map<string, { red: number; yellow: number; green: number }>();

    for (const tab of this.tabs()) {
      let red = 0;
      let yellow = 0;
      let green = 0;

      for (const rbId of tab.rbIds ?? []) {
        const item = byId.get(rbId);
        const status = item
          ? calculateStatus(item.minResp ?? null, item.maxResp ?? null, item.secondMinResp ?? null, item.secondMaxResp ?? null, now)
          : undefined;
        if (status === RbStatus.NotInResp) red++;
        else if (status === RbStatus.SoonResp || status === RbStatus.SoonSecondResp) yellow++;
        else if (status === RbStatus.InResp || status === RbStatus.SecondResp) green++;
      }

      result.set(tab.id, { red, yellow, green });
    }

    return result;
  });

  getTabStatusCounts(tabId: string): { red: number; yellow: number; green: number } {
    return this.tabStatusCounts().get(tabId) ?? { red: 0, yellow: 0, green: 0 };
  }

  private readonly segmentTitles: Record<string, string> = {
    red: 'Убит, ждём респа',
    yellow: 'Час до респа',
    green: 'В респе / во втором респе',
  };

  getTabStatusSegments(tab: CustomBossTab): { cls: string; value: number; title: string }[] {
    const counts = this.getTabStatusCounts(tab.id);
    const segments: { cls: string; value: number; title: string }[] = [];
    if (counts.red) segments.push({ cls: 'red', value: counts.red, title: this.segmentTitles['red'] });
    if (counts.yellow) segments.push({ cls: 'yellow', value: counts.yellow, title: this.segmentTitles['yellow'] });
    if (counts.green) segments.push({ cls: 'green', value: counts.green, title: this.segmentTitles['green'] });
    return segments;
  }

  constructor() {
    this.noGradeRb
      .getRaidBosses()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => this.items.set((items ?? []).map((item) => enrichJsonRb(item))));

    timer(0, 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));
  }

  // Everything except the live resp filters — stays free of a `now` dependency, so
  // item object references are stable across renders unless the tab/items actually
  // change (no per-second rebuild).
  private baseActiveTabItems = computed(() => {
    const tab = this.activeTab();
    if (!tab) return [];

    const idSet = new Set(tab.rbIds ?? []);
    return this.items().filter((item) => idSet.has(item?.id));
  });

  // Reads `this.now()` only when a resp filter is active — see the matching comment on
  // HomeNewComponent.visibleItems for why: recreating a boss's object every second
  // while its kill-time is being edited resets the datepicker mid-edit.
  activeTabItems = computed(() => {
    const items = this.baseActiveTabItems();
    const onlyResp = this.showOnlyResp();
    const oneHour = this.showOneHourToResp();

    if (!onlyResp && !oneHour) {
      return items.slice().sort((a, b) => Number(a?.lvl ?? 0) - Number(b?.lvl ?? 0));
    }

    const now = this.now();
    const hourMs = 60 * 60 * 1000;

    return items
      .filter((item) => {
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
      .sort((a, b) => Number(a?.lvl ?? 0) - Number(b?.lvl ?? 0));
  });

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

    this.noGradeRb
      .setKillTime(rbId, event.deadTime, {
        bossName: event.rb?.displayName || event.rb?.name,
      })
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

  removeFromActiveTab(item: any): void {
    const rbId = item?.id;
    if (!rbId) return;

    const tab = this.activeTab();
    if (!tab) return;

    this.updateTabRbIds(
      tab.id,
      (tab.rbIds ?? []).filter((id) => id !== rbId)
    );
    this.voice.action('rbRemove');
  }

  // ---- bookmark CRUD (persisted to localStorage) ----

  openCreateTabDialog(): void {
    this.tabDialogMode.set('create');
    this.tabNameDraft.set('');
    this.tabHiddenDraft.set(false);
    this.editingTabId = null;
    this.tabDialogVisible.set(true);
  }

  openRenameTabDialog(tab: CustomBossTab, event: Event): void {
    event.stopPropagation();
    this.tabDialogMode.set('rename');
    this.tabNameDraft.set(tab.name);
    this.tabHiddenDraft.set(!!tab.hidden);
    this.editingTabId = tab.id;
    this.tabDialogVisible.set(true);
  }

  saveTabDialog(): void {
    const name = this.tabNameDraft().trim();
    if (!name) return;

    if (this.tabDialogMode() === 'create') {
      const newTab: CustomBossTab = { id: this.generateId(), name, rbIds: [] };
      const next = [...this.tabs(), newTab];
      this.tabs.set(next);
      this.writeStoredTabs(next);
      this.activeTabId.set(newTab.id);
      this.activityLog.log('Создал закладку', name);
      this.voice.action('tabCreate');
    } else if (this.editingTabId) {
      const editingId = this.editingTabId;
      const hidden = this.tabHiddenDraft();
      const prev = this.tabs().find((t) => t.id === editingId);
      const next = this.tabs().map((t) => (t.id === editingId ? { ...t, name, hidden } : t));
      this.tabs.set(next);
      this.writeStoredTabs(next);
      const renamed = prev && prev.name !== name ? `${prev.name} → ${name}` : name;
      this.activityLog.log('Изменил закладку', renamed);
      this.voice.action('tabRename');

      if (hidden && this.activeTabId() === editingId) {
        this.activeTabId.set(next.find((t) => !t.hidden)?.id ?? '');
      } else if (!hidden) {
        this.activeTabId.set(editingId);
      }
    }

    this.tabDialogVisible.set(false);
  }

  confirmDeleteTab(tab: CustomBossTab, event: Event): void {
    event.stopPropagation();
    this.confirmationService.confirm({
      target: event.target as EventTarget,
      header: 'Удалить закладку',
      message: `Удалить закладку "${tab.name}"? Сами боссы из общего списка удалены не будут.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Удалить',
      rejectLabel: 'Отмена',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => this.deleteTab(tab.id),
    });
  }

  /** true once a raid boss actually has a kill time set */
  private hasKillTime(item: any): boolean {
    return item?.deadTime instanceof Date || item?.lastDeadTime != null;
  }

  /** ids of the RBs in this tab that currently have a kill time (nothing else needs clearing) */
  private tabRespRbIds(tab: CustomBossTab): string[] {
    const idSet = new Set(tab.rbIds ?? []);
    return this.items()
      .filter((item) => idSet.has(item?.id) && this.hasKillTime(item))
      .map((item) => item.id as string);
  }

  /** how many RBs in this tab have a kill time — drives the button's label + disabled state */
  tabRespCount(tab: CustomBossTab): number {
    return this.tabRespRbIds(tab).length;
  }

  /* ---- «Очистить респы» dialog: pick which statuses to wipe ---- */

  readonly clearDialogTab = signal<CustomBossTab | null>(null);
  /** statuses ticked in the dialog — nothing by default, the user picks */
  readonly clearStatuses = signal<Set<RbStatus>>(new Set());

  private liveStatus(item: any, now: number): RbStatus {
    return calculateStatus(item?.minResp ?? null, item?.maxResp ?? null, item?.secondMinResp ?? null, item?.secondMaxResp ?? null, now);
  }

  /** every status option with how many of the tab's timed RBs are in it right now */
  readonly clearOptions = computed(() => {
    const tab = this.clearDialogTab();
    const now = this.now();
    const counts = new Map<RbStatus, number>();
    if (tab) {
      const idSet = new Set(tab.rbIds ?? []);
      for (const item of this.items()) {
        if (!idSet.has(item?.id) || !this.hasKillTime(item)) continue;
        const s = this.liveStatus(item, now);
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    }
    return CLEAR_STATUS_OPTIONS.map((o) => ({ ...o, count: counts.get(o.status) ?? 0 })).filter(
      (o) => o.status !== RbStatus.Unknown || o.count > 0,
    );
  });

  readonly clearSelectedCount = computed(() => {
    const picked = this.clearStatuses();
    return this.clearOptions().reduce((sum, o) => sum + (picked.has(o.status) ? o.count : 0), 0);
  });

  isClearStatusOn(s: RbStatus): boolean {
    return this.clearStatuses().has(s);
  }
  toggleClearStatus(s: RbStatus): void {
    const next = new Set(this.clearStatuses());
    next.has(s) ? next.delete(s) : next.add(s);
    this.clearStatuses.set(next);
  }
  toggleAllClearStatuses(): void {
    const withTime = this.clearOptions().filter((o) => o.count > 0);
    const allOn = withTime.length > 0 && withTime.every((o) => this.clearStatuses().has(o.status));
    this.clearStatuses.set(allOn ? new Set() : new Set(withTime.map((o) => o.status)));
  }

  // Wipe the kill time for the tab's RBs whose CURRENT status is one of the
  // ticked ones. RBs with no time are never touched.
  confirmClearAllResp(tab: CustomBossTab, event: Event): void {
    event.stopPropagation();
    if (!this.tabRespRbIds(tab).length) return;
    this.clearStatuses.set(new Set());
    this.clearDialogTab.set(tab);
  }
  closeClearDialog(): void {
    this.clearDialogTab.set(null);
  }
  // step 2: one more "точно?" before anything is wiped (shared data)
  acceptClearDialog(): void {
    const tab = this.clearDialogTab();
    const statuses = new Set(this.clearStatuses());
    const count = this.clearSelectedCount();
    if (!tab || !statuses.size || !count) return;
    const labels = this.clearOptions()
      .filter((o) => statuses.has(o.status))
      .map((o) => `«${o.label}»`)
      .join(', ');
    this.clearDialogTab.set(null);
    // after the status dialog has closed — the confirm shares the page's p-confirmDialog
    setTimeout(
      () =>
        this.confirmationService.confirm({
          header: 'Очистить респы',
          message: `Удалить время убийства у ${count} РБ закладки "${tab.name}" (${labels})? Вернуть можно только вручную.`,
          icon: 'pi pi-exclamation-triangle',
          acceptLabel: 'Очистить',
          rejectLabel: 'Отмена',
          acceptButtonStyleClass: 'p-button-danger',
          rejectButtonStyleClass: 'p-button-text',
          accept: () => this.clearAllResp(tab, statuses),
        }),
      250,
    );
  }

  private clearAllResp(tab: CustomBossTab, statuses: Set<RbStatus>): void {
    const now = Date.now();
    const timed = new Set(this.tabRespRbIds(tab));
    const rbIds = this.items()
      .filter((item) => timed.has(item?.id) && statuses.has(this.liveStatus(item, now)))
      .map((item) => item.id as string);
    if (!rbIds.length) return;

    const idSet = new Set(rbIds);
    this.items.update((items) =>
      (items ?? []).map((item) =>
        idSet.has(item?.id) ? enrichJsonRb({ ...item, lastDeadTime: null }) : item
      )
    );

    Promise.allSettled(
      rbIds.map((id) => this.noGradeRb.setKillTime(id, null, { silent: true })),
    ).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected').length;
      const cleared = rbIds.length - failed;
      if (cleared > 0) {
        this.activityLog.log('Очистил время убийства РБ', `${tab.name}: ${cleared}`);
        this.voice.action('clearAll');
      }
      if (failed) {
        this.messageService.add({
          severity: 'warn',
          summary: `Не удалось очистить: ${failed} из ${rbIds.length}`,
          life: 3500,
        });
      } else {
        this.messageService.add({ severity: 'success', summary: 'Респы очищены', life: 2500 });
      }
    });
  }

  private deleteTab(tabId: string): void {
    const gone = this.tabs().find((t) => t.id === tabId);
    const next = this.tabs().filter((t) => t.id !== tabId);
    this.tabs.set(next);
    this.writeStoredTabs(next);

    if (this.activeTabId() === tabId) {
      this.activeTabId.set(next.find((t) => !t.hidden)?.id ?? '');
    }
    this.activityLog.log('Удалил закладку', gone?.name ?? '');
    this.voice.action('tabDelete');
  }

  showTab(tab: CustomBossTab): void {
    const next = this.tabs().map((t) => (t.id === tab.id ? { ...t, hidden: false } : t));
    this.tabs.set(next);
    this.writeStoredTabs(next);
    this.activeTabId.set(tab.id);
  }

  onActiveTabChange(value: string | number): void {
    this.activeTabId.set(String(value));
  }

  // Reorders only the visible tabs among themselves — any hidden tabs keep their
  // absolute slot in the underlying array, so dragging never shuffles a bookmark
  // you can't currently see.
  onTabDrop(event: CdkDragDrop<CustomBossTab[]>): void {
    if (event.previousIndex === event.currentIndex) return;

    const reorderedVisible = this.visibleTabs().slice();
    moveItemInArray(reorderedVisible, event.previousIndex, event.currentIndex);

    let visibleIndex = 0;
    const next = this.tabs().map((t) => (t.hidden ? t : reorderedVisible[visibleIndex++]));

    this.tabs.set(next);
    this.writeStoredTabs(next);
  }

  updateTabRbIds(tabId: string, rbIds: string[]): void {
    const next = this.tabs().map((t) => (t.id === tabId ? { ...t, rbIds: [...(rbIds ?? [])] } : t));
    this.tabs.set(next);
    this.writeStoredTabs(next);
  }

  private readStoredTabs(): CustomBossTab[] {
    try {
      const raw = localStorage.getItem(this.LS_TABS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((t: any) => t && typeof t.id === 'string' && typeof t.name === 'string')
        .map((t: any) => ({
          id: t.id,
          name: t.name,
          rbIds: Array.isArray(t.rbIds) ? t.rbIds.map(String) : [],
          hidden: !!t.hidden,
        }));
    } catch {
      return [];
    }
  }

  private writeStoredTabs(tabs: CustomBossTab[]): void {
    try {
      localStorage.setItem(this.LS_TABS, JSON.stringify(tabs));
    } catch {
      // ignore storage errors
    }
  }

  private generateId(): string {
    const cryptoObj = (globalThis as any).crypto;
    if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
