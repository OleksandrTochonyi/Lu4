import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Timestamp } from 'firebase/firestore';
import { FormsModule } from '@angular/forms';
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

import { RbData } from '../../services/rb-data';
import { RbStatus } from '../../constants/status';
import { enrichRbItem } from '../../utils/rb-enrich';
import { getRbKey, readHiddenIds } from '../../utils/rb-hidden';
import { RbListComponent } from '../rb-overview/components/rb-list/rb-list.component';
import { RbGridComponent } from '../rb-overview/components/rb-grid/rb-grid.component';

interface CustomBossTab {
  id: string;
  name: string;
  rbIds: string[];
  hidden?: boolean;
}

@Component({
  selector: 'app-bookmarks',
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
    RbListComponent,
    RbGridComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './bookmarks.component.html',
  styleUrl: './bookmarks.component.scss',
})
export class BookmarksComponent {
  private destroyRef = inject(DestroyRef);
  private rbDataService = inject(RbData);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);

  private readonly LS_TABS = 'rb-custom-tabs';
  private readonly LS_VIEW_MODE = 'rb-view-mode';

  items = signal<any[]>([]);
  hiddenIds = signal<Set<string>>(readHiddenIds());

  tabs = signal<CustomBossTab[]>(this.readStoredTabs());
  activeTabId = signal<string>(this.tabs().find((t) => !t.hidden)?.id ?? '');

  visibleTabs = computed(() => this.tabs().filter((t) => !t.hidden));
  hiddenTabs = computed(() => this.tabs().filter((t) => t.hidden));

  showTableView = signal(this.readStoredViewMode());

  // create/rename bookmark dialog state
  tabDialogVisible = signal(false);
  tabDialogMode = signal<'create' | 'rename'>('create');
  tabNameDraft = signal('');
  tabHiddenDraft = signal(false);
  private editingTabId: string | null = null;

  // RB picker level filter (from/to) — narrows the multiSelect's dropdown options.
  pickerLevelFrom = signal<number | null>(null);
  pickerLevelTo = signal<number | null>(null);

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

  // Options shown in the dropdown: level-filtered, but an already-selected RB always
  // stays present so its chip keeps resolving a label even if it falls outside the range.
  // With only one bound filled in, that bound is an exact level match, not an open range —
  // e.g. "от" = 10 alone shows only level-10 bosses, not "10 and up".
  filteredRbOptions = computed(() => {
    const from = this.pickerLevelFrom();
    const to = this.pickerLevelTo();
    const options = this.rbOptions();
    if (from == null && to == null) return options;

    const activeTab = this.tabs().find((t) => t.id === this.activeTabId());
    const selectedIds = new Set(activeTab?.rbIds ?? []);

    const matchesLevel =
      from != null && to != null
        ? (level: number) => level >= from && level <= to
        : from != null
          ? (level: number) => level === from
          : (level: number) => level === to;

    return options.filter((opt) => selectedIds.has(opt.value) || matchesLevel(opt.level));
  });

  resetPickerLevelFilter(): void {
    this.pickerLevelFrom.set(null);
    this.pickerLevelTo.set(null);
  }

  // Red/yellow/green breakdown shown on each bookmark's header, alongside the total count.
  // Based on the snapshot `status` computed when `items` was last enriched (same
  // staleness the rest of the app already accepts between Firestore updates) rather
  // than a live per-second recompute, so it stays cheap.
  tabStatusCounts = computed(() => {
    const byId = new Map<string, any>();
    for (const item of this.items()) {
      if (item?.id) byId.set(item.id, item);
    }

    const result = new Map<string, { red: number; yellow: number; green: number }>();

    for (const tab of this.tabs()) {
      let red = 0;
      let yellow = 0;
      let green = 0;

      for (const rbId of tab.rbIds ?? []) {
        const status = byId.get(rbId)?.status;
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

  // Segments for the bookmark-header badge: red/yellow/green when present, in a single row.
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
    this.rbDataService
      .getItems()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => {
        this.items.set((items ?? []).map((item) => enrichRbItem(item)));
      });
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

  private readStoredViewMode(): boolean {
    try {
      return localStorage.getItem(this.LS_VIEW_MODE) === 'table';
    } catch {
      return false;
    }
  }

  // A plain method here would re-run (and hand out fresh object references) on every
  // change-detection tick — including the per-second ticks each rb-item's own timer
  // triggers — which would invalidate every row's cached computeds and re-render the
  // whole list every second. computed() keeps the array reference stable unless the
  // active bookmark, its rbIds, the raid-boss data, or hidden-set actually changed.
  activeTabItems = computed(() => {
    const activeId = this.activeTabId();
    const tab = this.tabs().find((t) => t.id === activeId);
    if (!tab) return [];

    const idSet = new Set(tab.rbIds ?? []);
    const hidden = this.hiddenIds();

    return this.items()
      .filter((item) => idSet.has(item?.id))
      .map((item) => ({ ...item, hidden: hidden.has(getRbKey(item)) }))
      .sort((a, b) => Number(a?.lvl ?? 0) - Number(b?.lvl ?? 0));
  });

  // Home page's rb-item/rb-grid show a hide/show button by default; here that button
  // is swapped (via [showDeleteButton]) for one that removes the RB from this bookmark only —
  // the raid-boss data itself, and any global hidden-state, are untouched.
  removeFromActiveTab(item: any): void {
    const rbId = item?.id;
    if (!rbId) return;

    const activeId = this.activeTabId();
    const tab = this.tabs().find((t) => t.id === activeId);
    if (!tab) return;

    this.updateTabRbIds(
      tab.id,
      (tab.rbIds ?? []).filter((id) => id !== rbId)
    );
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
            summary: 'Сохранено',
            detail: 'Время убийства обновлено',
            life: 2500,
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

  // Un-hiding stays a one-click action from the "hidden bookmarks" list (there's nowhere
  // on the strip to open a hidden bookmark's settings from), and switches to it right away.
  showTab(tab: CustomBossTab): void {
    const next = this.tabs().map((t) => (t.id === tab.id ? { ...t, hidden: false } : t));
    this.tabs.set(next);
    this.writeStoredTabs(next);
    this.activeTabId.set(tab.id);
  }

  onActiveTabChange(value: string | number): void {
    this.activeTabId.set(String(value));
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
