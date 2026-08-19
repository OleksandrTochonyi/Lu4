import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
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
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

import { RbJsonDataService } from '../../services/rb-json-data.service';
import { RbJsonRespService } from '../../services/rb-json-resp.service';
import { getRbKey, readHiddenIds } from '../../utils/rb-hidden';
import { enrichJsonRb } from '../../utils/rb-json-enrich';
import { calculateStatus } from '../../utils/rb-enrich';
import { RbStatus } from '../../constants/status';
import { JsonRbCardComponent } from '../shared/json-rb-card/json-rb-card.component';

interface CustomBossTab {
  id: string;
  name: string;
  rbIds: string[];
  hidden?: boolean;
}

// Bookmarks page backed by the static db.json catalog instead of Firestore. Bookmark
// tabs themselves stay in localStorage (same mechanism as the original page) — only
// the raid-boss list they reference, and their kill time (rb-resp-time collection),
// come from the JSON catalog's own store. Resp math/status uses the same formula as
// the old Bookmarks page via the enrichJsonRb adapter.
@Component({
  selector: 'app-bookmarks-new',
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
    ConfirmDialogModule,
    DragDropModule,
    JsonRbCardComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './bookmarks-new.component.html',
  styleUrl: './bookmarks-new.component.scss',
})
export class BookmarksNewComponent {
  private destroyRef = inject(DestroyRef);
  private rbJsonData = inject(RbJsonDataService);
  private rbJsonResp = inject(RbJsonRespService);
  private confirmationService = inject(ConfirmationService);
  private messageService = inject(MessageService);

  private readonly LS_TABS = 'rb-new-custom-tabs';

  items = signal<any[]>([]);
  hiddenIds = signal<Set<string>>(readHiddenIds());
  // Ticks every second so tabStatusCounts/activeTabItems recompute each boss's status
  // live (against its fixed resp-window Dates) instead of relying on the stale
  // `.status` snapshot that `items` only refreshes on the next Firestore emission.
  private now = signal(Date.now());

  tabs = signal<CustomBossTab[]>(this.readStoredTabs());
  activeTabId = signal<string>(this.tabs().find((t) => !t.hidden)?.id ?? '');

  visibleTabs = computed(() => this.tabs().filter((t) => !t.hidden));
  hiddenTabs = computed(() => this.tabs().filter((t) => t.hidden));

  activeTab = computed(() => this.tabs().find((t) => t.id === this.activeTabId()) ?? null);

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
    this.rbJsonData
      .getRaidBosses()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => this.items.set((items ?? []).map((item) => enrichJsonRb(item))));

    timer(0, 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));
  }

  activeTabItems = computed(() => {
    const tab = this.activeTab();
    if (!tab) return [];

    const idSet = new Set(tab.rbIds ?? []);
    const hidden = this.hiddenIds();
    const now = this.now();
    const hourMs = 60 * 60 * 1000;
    const onlyResp = this.showOnlyResp();
    const oneHour = this.showOneHourToResp();

    return this.items()
      .filter((item) => idSet.has(item?.id))
      .map((item) => ({ ...item, hidden: hidden.has(getRbKey(item)) }))
      .filter((item) => {
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

  removeFromActiveTab(item: any): void {
    const rbId = item?.id;
    if (!rbId) return;

    const tab = this.activeTab();
    if (!tab) return;

    this.updateTabRbIds(
      tab.id,
      (tab.rbIds ?? []).filter((id) => id !== rbId)
    );
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
    } else if (this.editingTabId) {
      const editingId = this.editingTabId;
      const hidden = this.tabHiddenDraft();
      const next = this.tabs().map((t) => (t.id === editingId ? { ...t, name, hidden } : t));
      this.tabs.set(next);
      this.writeStoredTabs(next);

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

  private deleteTab(tabId: string): void {
    const next = this.tabs().filter((t) => t.id !== tabId);
    this.tabs.set(next);
    this.writeStoredTabs(next);

    if (this.activeTabId() === tabId) {
      this.activeTabId.set(next.find((t) => !t.hidden)?.id ?? '');
    }
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
