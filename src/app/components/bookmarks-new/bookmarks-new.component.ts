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
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

import { RbJsonDataService } from '../../services/rb-json-data.service';
import { RbJsonRespService } from '../../services/rb-json-resp.service';
import { AuthService } from '../../services/auth.service';
import { OnboardingService } from '../../services/onboarding.service';
import { getRbKey, readHiddenIds } from '../../utils/rb-hidden';
import { enrichJsonRb } from '../../utils/rb-json-enrich';
import { calculateStatus } from '../../utils/rb-enrich';
import { RbStatus } from '../../constants/status';
import { JsonRbCardComponent } from '../shared/json-rb-card/json-rb-card.component';
import { GuidedTourComponent, TourStep } from '../shared/guided-tour/guided-tour.component';

const BOOKMARKS_TOUR_STEPS: TourStep[] = [
  {
    title: 'Добро пожаловать на Букмарки!',
    paragraphs: [
      'Это ваша личная страница закладок — то, что вы тут создадите, видите только вы.',
      'Сейчас за пару минут покажу, как всё устроено.',
      'В любой момент можно нажать «Пропустить обучение» внизу.',
    ],
  },
  {
    title: 'Закладки — вкладки сверху',
    paragraphs: [
      'Каждая вкладка — это одна закладка со своим набором рейд-боссов.',
      'Закладок может быть сколько угодно и любых: «Основной фарм», «Ивент», «Для пати» — ' +
        'раскладывайте боссов по смыслу, как вам удобно.',
      'Вкладки можно перетаскивать и менять местами.',
    ],
    target: '[data-tour="bm-tabs"]',
  },
  {
    title: 'Кнопка «Новая закладка»',
    paragraphs: ['Создаёт ещё одну закладку — просто дайте ей название, и она появится в списке вкладок.'],
    target: '[data-tour="bm-new-tab-btn"]',
  },
  {
    title: 'Добавление рейд-боссов',
    paragraphs: [
      'Тут вы добавляете боссов в открытую сейчас закладку.',
      'Есть фильтр по уровню («с» — «по») и кнопка «Добавить все» / «Убрать все» для массового ' +
        'добавления целого диапазона уровней разом.',
    ],
    target: '[data-tour="bm-rb-picker"]',
  },
  {
    title: 'Время убийства',
    paragraphs: [
      'Отмечайте здесь точное время, когда убили босса — по нему автоматически считается, когда он снова заспавнится.',
    ],
    bullets: [
      { icon: 'pi-check', text: 'сохранить правку времени' },
      { icon: 'pi-times', text: 'отменить правку' },
      { icon: 'pi-trash', text: 'стереть время убийства целиком' },
    ],
    target: '[data-tour="bm-kill-time"]',
  },
  {
    title: 'Мин, Макс и обратный отсчёт',
    paragraphs: [
      '«Мин» и «Макс» — это начало и конец окна респауна, посчитанные от времени убийства. Босс ' +
        'может заспавниться в любой момент между этими двумя значениями.',
      'Третье значение справа — живой обратный отсчёт: «До мин. респа», пока идёт ожидание, а ' +
        'дальше — «В респе уже», «До 2-го мин. респа» и так далее, в зависимости от текущего статуса.',
    ],
    target: '[data-tour="bm-resp-minmax"]',
  },
  {
    title: 'Цвет статуса закладки',
    paragraphs: ['Цифры на вкладке показывают статус боссов внутри неё:'],
    bullets: [
      { text: '🔴 красный — босс убит, респ ещё не подошёл' },
      { text: '🟡 жёлтый — респ примерно через час' },
      { text: '🟢 зелёный — босс уже в респе (или во втором респе) — самое время фармить' },
    ],
    target: '[data-tour="bm-status-pill"]',
  },
  {
    title: 'Кнопки на строке босса',
    paragraphs: ['У каждого босса есть свой набор кнопок:'],
    bullets: [
      { icon: 'pi-map-marker', text: 'показать босса на карте' },
      { icon: 'pi-refresh', text: 'поставить время убийства «прямо сейчас»' },
      { icon: 'pi-info-circle', text: 'инфо — характеристики и дроп босса' },
      { icon: 'pi-trash', text: 'убрать босса из этой закладки' },
    ],
    target: '[data-tour="bm-row-actions"]',
  },
  {
    title: 'Кнопки на панели закладки',
    paragraphs: ['А эти кнопки относятся ко всей открытой закладке сразу:'],
    bullets: [
      { icon: 'pi-eraser', text: '«Очистить респы» — разом стереть время убийства у всех боссов закладки' },
      { icon: 'pi-sliders-h', text: '«Фильтры» — показать только тех, кто в респе или через час до него' },
      { icon: 'pi-pencil', text: 'переименовать закладку' },
      { icon: 'pi-trash', text: 'удалить закладку целиком' },
    ],
    target: '[data-tour="bm-tab-actions"]',
  },
  {
    title: 'Готово!',
    paragraphs: [
      'Теперь вы знаете всё основное: создавайте закладки, добавляйте боссов, отмечайте время убийства.',
      'Респауны приложение посчитает само. Удачи на фарме!',
    ],
  },
];

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
    GuidedTourComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './bookmarks-new.component.html',
  styleUrl: './bookmarks-new.component.scss',
})
export class BookmarksNewComponent {
  private destroyRef = inject(DestroyRef);
  private rbJsonData = inject(RbJsonDataService);
  private auth = inject(AuthService);
  private onboarding = inject(OnboardingService);
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

  // ---- first-time onboarding tour ----

  readonly tourSteps = BOOKMARKS_TOUR_STEPS;
  readonly tourActive = signal(false);
  /** set once we know this user hasn't finished the tour yet — gates the kickoff effect below */
  private readonly pendingTourUid = signal<string | null>(null);

  onTourFinished(result: { skipped: boolean }): void {
    this.tourActive.set(false);
    const uid = this.pendingTourUid();
    // clear it FIRST — otherwise the kickoff effect below (which reacts to both
    // signals) sees tourActive flip back to false while pendingTourUid is still
    // set and immediately restarts the tour it was just told to close
    this.pendingTourUid.set(null);
    if (uid) void this.onboarding.markTourDone(uid, 'bookmarks', result.skipped);
  }

  // Creates a small starter bookmark for the tour to point at. Only ever called
  // for an account with zero bookmarks (the kickoff effect below won't start the
  // tour at all otherwise), so this never touches or overwrites real user data.
  private ensureTourContent(): void {
    const demoRbId = this.rbOptions()[0]?.value;
    const newTab: CustomBossTab = {
      id: this.generateId(),
      name: 'Моя первая закладка',
      rbIds: demoRbId ? [demoRbId] : [],
    };
    const next = [...this.tabs(), newTab];
    this.tabs.set(next);
    this.writeStoredTabs(next);
    this.activeTabId.set(newTab.id);
  }

  constructor() {
    this.rbJsonData
      .getRaidBosses()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => this.items.set((items ?? []).map((item) => enrichJsonRb(item))));

    timer(0, 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));

    this.auth.user$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((user) => {
      const uid = user?.uid ?? null;
      if (!uid) return;
      this.onboarding.hasCompletedTour(uid, 'bookmarks').then((done) => {
        if (!done) this.pendingTourUid.set(uid);
      });
    });

    // Waits for both the auth check above and the RB catalog to load (so a starter
    // bookmark can reference a real boss), then starts the tour exactly once — but
    // only for an account with NO bookmarks of its own yet. Someone who already has
    // real bookmarks clearly doesn't need the tour, even if they never happened to
    // finish/skip it (e.g. it rolled out after they'd already been using the page).
    effect(() => {
      if (
        this.tourActive() ||
        !this.pendingTourUid() ||
        this.items().length === 0 ||
        this.tabs().length > 0
      ) {
        return;
      }
      this.ensureTourContent();
      this.tourActive.set(true);
    });
  }

  // Everything except the live resp filters — stays free of a `now` dependency, so
  // item object references are stable across renders unless the tab/hidden-set/items
  // actually change (no per-second rebuild).
  private baseActiveTabItems = computed(() => {
    const tab = this.activeTab();
    if (!tab) return [];

    const idSet = new Set(tab.rbIds ?? []);
    const hidden = this.hiddenIds();

    return this.items()
      .filter((item) => idSet.has(item?.id))
      .map((item) => ({ ...item, hidden: hidden.has(getRbKey(item)) }));
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

  // Wipe the kill time for every RB in a bookmark *that has one* (each one's
  // rb-resp-time doc gets killTime: null, same as clearing it on the card).
  // RBs with no time are skipped — there's nothing to delete. Always behind a
  // confirm — it's a bulk, shared-data change.
  confirmClearAllResp(tab: CustomBossTab, event: Event): void {
    event.stopPropagation();

    const rbIds = this.tabRespRbIds(tab);
    if (!rbIds.length) return;

    this.confirmationService.confirm({
      target: event.target as EventTarget,
      header: 'Очистить респы',
      message: `Вы точно хотите удалить время убийства у РБ с временем в закладке "${tab.name}" (${rbIds.length})?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Очистить',
      rejectLabel: 'Отмена',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => this.clearAllResp(tab),
    });
  }

  private clearAllResp(tab: CustomBossTab): void {
    const rbIds = this.tabRespRbIds(tab);
    if (!rbIds.length) return;

    const idSet = new Set(rbIds);
    this.items.update((items) =>
      (items ?? []).map((item) =>
        idSet.has(item?.id) ? enrichJsonRb({ ...item, lastDeadTime: null }) : item
      )
    );

    Promise.allSettled(rbIds.map((id) => this.rbJsonResp.setKillTime(id, null))).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected').length;
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
