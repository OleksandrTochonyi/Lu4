import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService, MessageService } from 'primeng/api';

import { GradeBadgeComponent } from '../shared/grade-badge/grade-badge.component';
import { CostTableComponent } from '../shared/cost-table/cost-table.component';
import { CostTreeComponent } from '../shared/cost-tree/cost-tree.component';
import { CraftDetailComponent } from './craft-detail/craft-detail.component';
import {
  CRAFT_CATEGORY_LABEL,
  CraftCatalogService,
  CraftCategory,
  CraftEntry,
  CraftGrade,
  normName,
} from '../../services/craft-catalog.service';
import {
  CLAN_WAREHOUSE,
  CLAN_WAREHOUSE_ID,
  StockItem,
  Warehouse,
  WarehouseService,
} from '../../services/warehouse.service';
import { SiteUser, SiteUsersService, actorLabel } from '../../services/site-users.service';
import { AuthService } from '../../services/auth.service';
import { CraftCostCalc, recipeLabel } from '../../utils/craft-cost';

/** one line of the craft plan (localStorage) */
interface PlanItem {
  /** catalog entry id */
  id: string;
  /** index into the entry's `recipes` (60% / 70% / 100% / material) */
  recipeIdx: number;
  qty: number;
}

const LS_PLAN = 'wh-craft-plan';
/** last picked warehouse (per browser) */
const LS_ACTIVE_WH = 'wh-active';

/** 1 = crystal, 2 = gemstone, 0 = anything else */
function crystalRank(name: string): number {
  if (/gemstone|самоцвет|гемстоун/i.test(name)) return 2;
  if (/crystal|кристалл/i.test(name)) return 1;
  return 0;
}

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

@Component({
  selector: 'app-warehouse',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    TooltipModule,
    GradeBadgeComponent,
    CostTableComponent,
    CostTreeComponent,
    CraftDetailComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './warehouse.component.html',
  styleUrl: './warehouse.component.scss',
})
export class WarehouseComponent {
  private warehouse = inject(WarehouseService);
  private craftCatalog = inject(CraftCatalogService);
  private siteUsers = inject(SiteUsersService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private auth = inject(AuthService);

  /** email -> name from the site-users list, for the history dialog captions */
  private readonly actorNames = toSignal(this.siteUsers.namesByEmail$, {
    initialValue: new Map<string, string>(),
  });
  /** name for a stored email, or the email itself when we have no name */
  who(email: string | null | undefined): string {
    return actorLabel(email, this.actorNames());
  }

  readonly categoryLabel = CRAFT_CATEGORY_LABEL;
  // craftable categories worth showing — "Прочее" (other) is hidden
  readonly categories: CraftCategory[] = ['weapon', 'armor', 'jewelry', 'resource'];
  // grades offered / kept in the craft catalogue — NG, D and S are dropped
  readonly craftGrades: CraftGrade[] = ['C', 'B', 'A'];
  private readonly hiddenCraftGrades = new Set<CraftGrade>(['NG', 'D', 'S']);
  private readonly hiddenCraftCategories = new Set<CraftCategory>(['other']);

  readonly view = signal<'stock' | 'craft' | 'plan' | 'history'>('stock');

  /**
   * "История" tab: every change from every stock row's own capped `history`
   * (last 5 per row), flattened into one newest-first feed for the whole
   * active warehouse, so you don't have to open each resource.
   */
  readonly historySearch = signal('');
  readonly combinedHistory = computed(() => {
    const q = this.historySearch().trim().toLowerCase();
    const rows: {
      key: string;
      ts: number;
      itemName: string;
      icon: string | null;
      byEmail: string;
      from: number;
      to: number;
    }[] = [];
    for (const item of this.stockSorted()) {
      item.history.forEach((h, i) =>
        rows.push({
          key: `${item.id}#${i}`,
          ts: h.ts,
          itemName: item.name,
          icon: item.icon,
          byEmail: h.byEmail,
          from: h.from,
          to: h.to,
        }),
      );
    }
    return rows
      .filter(
        (r) =>
          !q ||
          r.itemName.toLowerCase().includes(q) ||
          r.byEmail.toLowerCase().includes(q) ||
          this.who(r.byEmail).toLowerCase().includes(q),
      )
      .sort((a, b) => b.ts - a.ts);
  });
  trackHist = (_: number, r: { key: string }) => r.key;

  /* ------------------------------------------------------------------ data */

  /* ------------------------------------------------------------ warehouses */

  readonly myEmail = toSignal(
    this.auth.user$.pipe(
      map((u) => String(u?.email ?? '').trim().toLowerCase()),
      distinctUntilChanged(),
    ),
    { initialValue: '' },
  );
  private readonly canClan = toSignal(this.siteUsers.canClanWarehouse$, { initialValue: false });
  private readonly allUsers = toSignal(this.siteUsers.siteUsers$, { initialValue: [] as SiteUser[] });
  private readonly siteUsersLoaded = computed(() => this.allUsers().length > 0);

  /** personal + shared ones I'm a member of, straight from Firestore */
  private readonly myWarehouses = toSignal(
    toObservable(this.myEmail).pipe(
      switchMap((e) => (e ? this.warehouse.myWarehouses$(e) : of([] as Warehouse[]))),
    ),
    { initialValue: [] as Warehouse[] },
  );

  /** the switcher list: Мой склад → Склад клана (if allowed) → shared ones by name */
  readonly warehouses = computed<Warehouse[]>(() => {
    const mine = this.myWarehouses();
    const personal = mine.filter((w) => w.type === 'personal');
    const shared = mine
      .filter((w) => w.type === 'shared')
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...personal, ...(this.canClan() ? [CLAN_WAREHOUSE] : []), ...shared];
  });

  readonly activeWarehouseId = signal<string | null>(readLS(LS_ACTIVE_WH));
  readonly activeWarehouse = computed<Warehouse | null>(() => {
    const list = this.warehouses();
    return list.find((w) => w.id === this.activeWarehouseId()) ?? null;
  });

  selectWarehouse(id: string): void {
    if (id === this.activeWarehouseId()) return;
    this.cancelEdit();
    this.activeWarehouseId.set(id);
    writeLS(LS_ACTIVE_WH, id);
  }

  warehouseLabel(w: Warehouse): string {
    return w.type === 'personal' ? 'Мой склад' : w.name;
  }
  warehouseIcon(w: Warehouse): string {
    return w.type === 'personal' ? 'pi-user' : w.type === 'clan' ? 'pi-shield' : 'pi-users';
  }
  /** only a shared warehouse's creator may rename it, change members or delete it */
  canManage(w: Warehouse | null): boolean {
    return !!w && w.type === 'shared' && w.ownerEmail === this.myEmail();
  }

  constructor() {
    // every signed-in user always has exactly one personal warehouse
    effect(() => {
      const e = this.myEmail();
      if (e) this.warehouse.ensurePersonal(e).catch(() => null);
    });

    // keep the selection valid: fall back to the personal warehouse when the
    // remembered one is gone (deleted, removed from members, clan access revoked)
    effect(
      () => {
        const list = this.warehouses();
        if (!list.length) return;
        const cur = this.activeWarehouseId();
        if (cur && list.some((w) => w.id === cur)) return;
        // the clan entry shows up only once the access list has loaded — don't
        // drop a remembered clan pick before that
        if (cur === CLAN_WAREHOUSE_ID && !this.siteUsersLoaded()) return;
        const next = (list.find((w) => w.type === 'personal') ?? list[0]).id;
        this.activeWarehouseId.set(next);
        writeLS(LS_ACTIVE_WH, next);
      },
      { allowSignalWrites: true },
    );
  }

  readonly stock = toSignal(
    toObservable(computed(() => this.activeWarehouse()?.id ?? '')).pipe(
      distinctUntilChanged(),
      switchMap((id) => (id ? this.warehouse.stockOf$(id) : of([] as StockItem[]))),
    ),
    { initialValue: [] as StockItem[] },
  );
  readonly catalog = toSignal(this.craftCatalog.catalog$, { initialValue: [] as CraftEntry[] });

  /** catalogue lookup for re-deriving a stock row's icon/grade from the live data */
  private readonly catalogIndex = computed(() => {
    const byId = new Map<string, CraftEntry>();
    const byName = new Map<string, CraftEntry>();
    for (const e of this.catalog()) {
      byId.set(e.id, e);
      const n = normName(e.name);
      if (n && !byName.has(n)) byName.set(n, e);
    }
    return { byId, byName };
  });

  /**
   * A stored row may have no icon (added by free text, or before the icon mirror
   * was filled). Re-match it against the catalogue by catalogId / normalized name
   * so the same resource shows the same picture everywhere.
   */
  private enrichStock(item: StockItem): StockItem {
    const { byId, byName } = this.catalogIndex();
    const e = (item.catalogId ? byId.get(item.catalogId) : undefined) ?? byName.get(normName(item.name));
    if (!e) return item;
    return {
      ...item,
      icon: e.icon ?? item.icon ?? null,
      grade: item.grade ?? e.grade ?? null,
      category: item.category ?? e.category ?? null,
    };
  }

  readonly stockSorted = computed(() =>
    [...this.stock()]
      .map((i) => this.enrichStock(i))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  readonly stockTotal = computed(() => this.stock().reduce((s, i) => s + i.qty, 0));

  /* --------------------------------------------------------------- stock UI */

  readonly stockSearch = signal('');
  readonly filteredStock = computed(() => {
    const q = this.stockSearch().trim().toLowerCase();
    if (!q) return this.stockSorted();
    return this.stockSorted().filter((i) => i.name.toLowerCase().includes(q));
  });

  /** stock split into "рецепты" / "части" / "ресурсы", each collapsible */
  readonly stockRecipes = computed(() =>
    this.filteredStock().filter((i) => i.category === 'recipe'),
  );
  readonly stockParts = computed(() =>
    this.filteredStock().filter((i) => i.category === 'part'),
  );
  private readonly stockPlainRes = computed(() =>
    this.filteredStock().filter((i) => i.category !== 'part' && i.category !== 'recipe'),
  );
  /** plain resources minus crystals / gemstones — those get their own group below */
  readonly stockResources = computed(() => this.stockPlainRes().filter((i) => !crystalRank(i.name)));
  /** crystals first, then gemstones, each by name */
  readonly stockCrystals = computed(() =>
    this.stockPlainRes()
      .filter((i) => crystalRank(i.name))
      .sort((a, b) => crystalRank(a.name) - crystalRank(b.name) || a.name.localeCompare(b.name)),
  );
  readonly recipesOpen = signal(true);
  readonly partsOpen = signal(true);
  readonly resOpen = signal(true);
  readonly crystalsOpen = signal(true);

  /** inline quantity edit */
  readonly editId = signal<string | null>(null);
  readonly editVal = signal(0);
  readonly savingQty = signal(false);

  startEdit(item: StockItem): void {
    this.editId.set(item.id);
    this.editVal.set(item.qty);
  }
  cancelEdit(): void {
    this.editId.set(null);
  }
  async saveEdit(item: StockItem): Promise<void> {
    if (this.savingQty()) return;
    const next = Math.max(0, Math.round(Number(this.editVal()) || 0));
    if (next === item.qty) {
      this.cancelEdit();
      return;
    }
    this.savingQty.set(true);
    try {
      const w = this.activeWarehouse();
      if (!w) throw new Error('Склад не выбран');
      await this.warehouse.setQty(w, item.id, next);
      this.toast('success', 'Количество обновлено', `${item.name}: ${item.qty} → ${next}`);
      this.cancelEdit();
    } catch (e) {
      this.toast('error', 'Ошибка', this.msg(e));
    } finally {
      this.savingQty.set(false);
    }
  }
  /**
   * +/- only stage a pending change locally (same draft as clicking the number
   * itself) — nothing is sent to Firestore until ✓ (saveEdit), and ✕ (cancelEdit)
   * discards it. Avoids a write + history entry per click when someone is just
   * nudging a value up/down a few times.
   */
  bump(item: StockItem, delta: number): void {
    const base = this.editId() === item.id ? this.editVal() : item.qty;
    this.editId.set(item.id);
    this.editVal.set(Math.max(0, Math.round(Number(base) || 0) + delta));
  }

  /* history dialog */
  readonly historyItem = signal<StockItem | null>(null);
  openHistory(item: StockItem): void {
    this.historyItem.set(item);
  }
  closeHistory(): void {
    this.historyItem.set(null);
  }

  /** the warehouse only ever holds raw resources, crafting parts ("кучки") and
   *  gear recipes (weapon / armor / jewelry, grade C and up) — no finished gear */
  private isStockable(e: CraftEntry): boolean {
    if (e.category === 'recipe') return /^(?:weapon|armor|jewelry)-recipes-(?:C|B|A|S)$/i.test(e.section);
    return e.category === 'resource' || e.category === 'part';
  }

  /* ------------------------------------------------------ bulk add dialog */

  readonly addOpen = signal(false);
  readonly addSearch = signal('');
  readonly addCat = signal<'all' | 'resource' | 'part' | 'recipe'>('all');
  readonly addComplexity = signal<'all' | 'simple' | 'composite'>('all');
  readonly addGrades = signal<Set<CraftGrade>>(new Set());
  /** catalog id → qty to add */
  readonly addSelected = signal<Map<string, number>>(new Map());
  readonly adding = signal(false);

  openAdd(): void {
    this.addSearch.set('');
    this.addCat.set('all');
    this.addComplexity.set('all');
    this.addGrades.set(new Set());
    this.addSelected.set(new Map());
    this.addOpen.set(true);
  }
  closeAdd(): void {
    this.addOpen.set(false);
  }

  private readonly addBase = computed(() => this.catalog().filter((e) => this.isStockable(e)));

  /** already-on-stock rows keyed by catalogId — the picker marks them "на складе: N" */
  private readonly stockByCatalogId = computed(() => {
    const m = new Map<string, StockItem>();
    for (const s of this.stock()) if (s.catalogId) m.set(s.catalogId, s);
    return m;
  });
  addOwned(id: string): StockItem | undefined {
    return this.stockByCatalogId().get(id);
  }

  /** grade only varies meaningfully for recipes — resources/parts don't carry a useful one */
  readonly addGradesAvail = computed<CraftGrade[]>(() => {
    const set = new Set<CraftGrade>();
    for (const e of this.addBase()) if (e.category === 'recipe' && e.grade) set.add(e.grade);
    return this.craftGrades.filter((g) => set.has(g));
  });

  readonly addFiltered = computed(() => {
    const q = normName(this.addSearch());
    const cat = this.addCat();
    const complexity = this.addComplexity();
    const grades = this.addGrades();
    return this.addBase()
      .filter((e) => {
        if (q && !normName(e.name).includes(q)) return false;
        if (cat !== 'all' && e.category !== cat) return false;
        // "простые/составные" only makes sense for plain resources
        if (cat === 'resource') {
          if (complexity === 'simple' && e.craftable) return false;
          if (complexity === 'composite' && !e.craftable) return false;
        }
        if (cat === 'recipe' && grades.size && (!e.grade || !grades.has(e.grade))) return false;
        return true;
      })
      .sort(
        (a, b) =>
          // what's already on this warehouse first, then crystals / gemstones last
          Number(!this.addOwned(a.id)) - Number(!this.addOwned(b.id)) ||
          this.addRank(a) - this.addRank(b) ||
          a.name.localeCompare(b.name),
      );
  });

  /** crystals then gemstones always sort last — only among plain resources, so
   *  "… Gemstone" parts/recipes keep their normal place */
  private addRank(e: CraftEntry): number {
    return e.category === 'resource' ? crystalRank(e.name) : 0;
  }

  setAddCat(c: 'all' | 'resource' | 'part' | 'recipe'): void {
    this.addCat.set(c);
  }
  toggleAddGrade(g: CraftGrade): void {
    const next = new Set(this.addGrades());
    next.has(g) ? next.delete(g) : next.add(g);
    this.addGrades.set(next);
  }

  isAddPicked(id: string): boolean {
    return this.addSelected().has(id);
  }
  addQtyOf(id: string): number {
    return this.addSelected().get(id) ?? 1;
  }
  /**
   * Picking an already-owned entry logs a NEW drop on top of what's on the shelf
   * (this dialog is "log what you just picked up", not "correct the shelf count"),
   * so submitAdd() adds the picked qty onto the existing row instead of making a
   * duplicate. Absolute corrections still happen in the stock table's qty editor.
   */
  toggleAddPick(e: CraftEntry): void {
    const next = new Map(this.addSelected());
    if (next.has(e.id)) next.delete(e.id);
    else next.set(e.id, 1);
    this.addSelected.set(next);
  }
  setAddQty(id: string, qty: number): void {
    if (!this.addSelected().has(id)) return;
    const next = new Map(this.addSelected());
    next.set(id, Math.max(1, Math.round(Number(qty) || 1)));
    this.addSelected.set(next);
  }
  bumpAddQty(id: string, delta: number, ev: Event): void {
    ev.stopPropagation();
    this.setAddQty(id, this.addQtyOf(id) + delta);
  }
  clearAddPicks(): void {
    this.addSelected.set(new Map());
  }
  readonly addSelectedCount = computed(() => this.addSelected().size);

  async submitAdd(): Promise<void> {
    if (this.adding()) return;
    const picks = [...this.addSelected().entries()];
    const w = this.activeWarehouse();
    if (!picks.length || !w) return;
    const byId = this.catalogIndex().byId;
    this.adding.set(true);
    try {
      await Promise.all(
        picks.map(([id, qty]) => {
          const e = byId.get(id);
          if (!e) return Promise.resolve();
          const owned = this.addOwned(id);
          if (owned) return this.warehouse.setQty(w, owned.id, owned.qty + qty);
          return this.warehouse.addItem(w, {
            name: e.name,
            catalogId: e.id,
            icon: e.icon ?? null,
            grade: e.grade,
            category: e.category,
            qty,
          });
        }),
      );
      this.toast(
        'success',
        'Добавлено на склад',
        `${picks.length} ${picks.length === 1 ? 'позиция' : 'позиций'}`,
      );
      this.addOpen.set(false);
    } catch (e) {
      this.toast('error', 'Ошибка', this.msg(e));
    } finally {
      this.adding.set(false);
    }
  }

  confirmDelete(item: StockItem): void {
    this.confirmationService.confirm({
      header: 'Удалить позицию',
      message: `Удалить «${item.name}» со склада?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Удалить',
      rejectLabel: 'Отмена',
      acceptButtonStyleClass: 'p-button-danger',
      accept: async () => {
        try {
          const w = this.activeWarehouse();
          if (!w) throw new Error('Склад не выбран');
          await this.warehouse.remove(w, item);
          this.toast('success', 'Удалено', item.name);
        } catch (e) {
          this.toast('error', 'Ошибка', this.msg(e));
        }
      },
    });
  }

  /* --------------------------------------------------------------- craft UI */

  readonly craftSearch = signal('');
  readonly catFilter = signal<CraftCategory | null>(null);
  readonly gradeFilter = signal<Set<CraftGrade>>(new Set());

  /** grade is only meaningful for gear + gear recipes */
  readonly gradeCategories = new Set<CraftCategory>(['weapon', 'armor', 'jewelry', 'recipe']);
  showGrade(cat: string): boolean {
    return this.gradeCategories.has(cat as CraftCategory);
  }

  onCraftSearch(v: string): void {
    this.craftSearch.set(v);
    this.page.set(0);
  }
  toggleCat(c: CraftCategory): void {
    this.catFilter.set(this.catFilter() === c ? null : c);
    this.page.set(0);
  }
  resetCraftFilters(): void {
    this.catFilter.set(null);
    this.gradeFilter.set(new Set());
    this.craftSearch.set('');
    this.page.set(0);
  }
  toggleGrade(g: CraftGrade): void {
    const next = new Set(this.gradeFilter());
    next.has(g) ? next.delete(g) : next.add(g);
    this.gradeFilter.set(next);
    this.page.set(0);
  }

  /** rows the catalogue view can ever show — craftable, allowed category + grade
   *  (before the category / grade / search chips are applied) */
  readonly craftBaseCatalog = computed(() =>
    this.catalog().filter(
      (e) =>
        e.craftable &&
        !this.hiddenCraftCategories.has(e.category) &&
        !(e.grade && this.hiddenCraftGrades.has(e.grade)),
    ),
  );

  readonly filteredCatalog = computed(() => {
    const q = normName(this.craftSearch());
    const cat = this.catFilter();
    const grades = this.gradeFilter();

    return this.craftBaseCatalog().filter((e) => {
      if (cat && e.category !== cat) return false;
      if (grades.size && (!e.grade || !grades.has(e.grade))) return false;
      if (q && !normName(e.name).includes(q)) return false;
      return true;
    });
  });

  /* -------- sort + custom pagination (no PrimeNG table quirks) -------- */

  readonly pageSizes = [15, 25, 50, 100];
  readonly sortField = signal<'name' | 'category' | 'gradeRank'>('name');
  readonly sortDir = signal<1 | -1>(1);
  readonly pageSize = signal(15);
  readonly page = signal(0);

  sortBy(f: 'name' | 'category' | 'gradeRank'): void {
    if (this.sortField() === f) this.sortDir.set((this.sortDir() * -1) as 1 | -1);
    else {
      this.sortField.set(f);
      this.sortDir.set(1);
    }
    this.page.set(0);
  }
  sortIcon(f: 'name' | 'category' | 'gradeRank'): string {
    if (this.sortField() !== f) return '';
    return this.sortDir() === 1 ? 'pi-arrow-up' : 'pi-arrow-down';
  }

  readonly sortedCatalog = computed(() => {
    const f = this.sortField();
    const d = this.sortDir();
    return [...this.filteredCatalog()].sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      if (f === 'category') {
        av = this.catLabel(a.category);
        bv = this.catLabel(b.category);
      } else if (f === 'gradeRank') {
        av = a.gradeRank;
        bv = b.gradeRank;
      } else {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      }
      return (av < bv ? -1 : av > bv ? 1 : 0) * d;
    });
  });

  readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.sortedCatalog().length / this.pageSize())),
  );
  readonly safePage = computed(() => Math.max(0, Math.min(this.page(), this.pageCount() - 1)));

  readonly pagedCatalog = computed(() => {
    const start = this.safePage() * this.pageSize();
    return this.sortedCatalog().slice(start, start + this.pageSize());
  });

  readonly pageInfo = computed(() => {
    const total = this.sortedCatalog().length;
    if (!total) return { start: 0, end: 0, total: 0 };
    const start = this.safePage() * this.pageSize();
    return { start: start + 1, end: Math.min(total, start + this.pageSize()), total };
  });

  /** up to 5 page numbers centred on the current one */
  readonly pageWindow = computed(() => {
    const total = this.pageCount();
    const cur = this.safePage();
    const span = Math.min(5, total);
    let start = Math.max(0, cur - Math.floor(span / 2));
    start = Math.min(start, total - span);
    return Array.from({ length: span }, (_, i) => start + i);
  });

  goPage(p: number): void {
    this.page.set(Math.max(0, Math.min(p, this.pageCount() - 1)));
  }
  setPageSize(s: number): void {
    this.pageSize.set(s || 15);
    this.page.set(0);
  }

  readonly detailEntry = signal<CraftEntry | null>(null);
  openDetail(e: CraftEntry): void {
    this.detailEntry.set(e);
  }
  closeDetail(): void {
    this.detailEntry.set(null);
  }

  /* ----------------------------------------------------------- craft plan --- */

  readonly recipeLabel = recipeLabel;
  readonly planItems = signal<PlanItem[]>(this.readStoredPlan());

  private readStoredPlan(): PlanItem[] {
    try {
      const raw = localStorage.getItem(LS_PLAN);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr
        .map((x: any) => ({
          id: String(x?.id ?? ''),
          recipeIdx: Math.max(0, Math.round(Number(x?.recipeIdx) || 0)),
          qty: Math.max(1, Math.round(Number(x?.qty) || 1)),
        }))
        .filter((x: PlanItem) => x.id);
    } catch {
      return [];
    }
  }
  private setPlan(items: PlanItem[]): void {
    this.planItems.set(items);
    try {
      localStorage.setItem(LS_PLAN, JSON.stringify(items));
    } catch {
      /* private window / quota — plan just won't persist */
    }
  }

  /** the plan joined to live catalogue entries + the chosen recipe */
  readonly planRows = computed(() => {
    const byId = this.catalogIndex().byId;
    return this.planItems().map((pi) => {
      const entry = byId.get(pi.id) ?? null;
      const recipes = entry?.recipes ?? [];
      const recipeIdx = recipes.length
        ? Math.min(pi.recipeIdx, recipes.length - 1)
        : 0;
      return { pi, entry, recipe: recipes[recipeIdx] ?? null, recipeIdx };
    });
  });

  readonly planCost = computed(() => {
    const roots = this.planRows()
      .filter((r) => r.recipe)
      .map((r) => ({ recipe: r.recipe!, qty: r.pi.qty }));
    return new CraftCostCalc(this.catalog(), this.stock()).computePlan(roots);
  });
  readonly planRollup = computed(() => this.planCost().rollup);
  /** plan result view: composite tree (default) vs flat resource list */
  readonly planFlat = signal(false);

  recipeOptionsFor(entry: CraftEntry | null): { value: number; label: string }[] {
    return (entry?.recipes ?? []).map((r, i) => ({ value: i, label: recipeLabel(r) }));
  }

  private defaultRecipeIdx(entry: CraftEntry): number {
    const rs = entry.recipes ?? [];
    if (rs.length <= 1) return 0;
    let best = 0;
    let bestChance = -1;
    rs.forEach((r, i) => {
      const c = parseInt(r.chance) || 0;
      if (c > bestChance) {
        bestChance = c;
        best = i;
      }
    });
    return best;
  }

  addToPlan(entry: CraftEntry): void {
    if (!entry?.craftable) return;
    const existing = this.planItems().findIndex((p) => p.id === entry.id);
    if (existing >= 0) {
      const next = this.planItems().map((p, i) =>
        i === existing ? { ...p, qty: p.qty + 1 } : p,
      );
      this.setPlan(next);
      this.toast('info', 'Уже в наборе', `${entry.name} — количество +1`);
      return;
    }
    this.setPlan([
      ...this.planItems(),
      { id: entry.id, recipeIdx: this.defaultRecipeIdx(entry), qty: 1 },
    ]);
  }
  removeFromPlan(idx: number): void {
    this.setPlan(this.planItems().filter((_, i) => i !== idx));
  }
  setPlanQty(idx: number, qty: number): void {
    const q = Math.max(1, Math.round(Number(qty) || 1));
    this.setPlan(this.planItems().map((p, i) => (i === idx ? { ...p, qty: q } : p)));
  }
  setPlanRecipe(idx: number, recipeIdx: number): void {
    this.setPlan(
      this.planItems().map((p, i) => (i === idx ? { ...p, recipeIdx } : p)),
    );
  }
  clearPlan(): void {
    this.setPlan([]);
  }

  trackPlan = (_: number, r: { pi: PlanItem }) => r.pi.id;

  /* ---- "Добавить предмет" picker dialog (own filter state, separate from the
   *      "Каталог крафта" view) ---- */

  readonly pickOpen = signal(false);
  /** the picker only offers gear — weapon / armor / jewelry */
  readonly pickCategories: CraftCategory[] = ['weapon', 'armor', 'jewelry'];
  readonly pickCat = signal<CraftCategory | null>(null);
  readonly pickGrades = signal<Set<CraftGrade>>(new Set());
  readonly pickSearch = signal('');

  openPick(): void {
    this.pickCat.set(null);
    this.pickGrades.set(new Set());
    this.pickSearch.set('');
    this.pickOpen.set(true);
  }
  closePick(): void {
    this.pickOpen.set(false);
  }
  togglePickCat(c: CraftCategory): void {
    this.pickCat.set(this.pickCat() === c ? null : c);
  }
  togglePickGrade(g: CraftGrade): void {
    const next = new Set(this.pickGrades());
    next.has(g) ? next.delete(g) : next.add(g);
    this.pickGrades.set(next);
  }

  /** craftable gear rows the picker can show (before the chips) */
  private readonly pickBase = computed(() =>
    this.catalog().filter(
      (e) =>
        e.craftable &&
        this.pickCategories.includes(e.category) &&
        !(e.grade && this.hiddenCraftGrades.has(e.grade)),
    ),
  );

  readonly pickFiltered = computed(() => {
    const cat = this.pickCat();
    const grades = this.pickGrades();
    const q = normName(this.pickSearch());
    return this.pickBase().filter((e) => {
      if (cat && e.category !== cat) return false;
      if (grades.size && (!e.grade || !grades.has(e.grade))) return false;
      if (q && !normName(e.name).includes(q)) return false;
      return true;
    });
  });

  /** picker rows grouped by grade: A → B → C → (без грейда), each name-sorted */
  readonly pickGroups = computed(() => {
    const order: (CraftGrade | '—')[] = ['A', 'B', 'C', '—'];
    const bucket = new Map<CraftGrade | '—', CraftEntry[]>();
    for (const e of this.pickFiltered()) {
      const k = (e.grade as CraftGrade) || '—';
      (bucket.get(k) ?? bucket.set(k, []).get(k)!).push(e);
    }
    return order
      .filter((g) => bucket.has(g))
      .map((g) => ({
        grade: g,
        label: g === '—' ? 'Без грейда' : `${g}-грейд`,
        items: bucket.get(g)!.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  });

  /** qty of this entry currently in the plan (0 = not added) */
  planQtyOf(id: string): number {
    return this.planItems().find((p) => p.id === id)?.qty ?? 0;
  }

  /* ------------------------------------- create / manage shared warehouse */

  /** 'create' = new shared warehouse, a Warehouse = editing that one */
  readonly whDialog = signal<'create' | Warehouse | null>(null);
  readonly whName = signal('');
  readonly whMembers = signal<Set<string>>(new Set());
  readonly whMemberSearch = signal('');
  readonly savingWh = signal(false);

  readonly whDialogEditing = computed(() => {
    const d = this.whDialog();
    return d && d !== 'create' ? d : null;
  });

  /** anyone on the access list (not blocked, not me) can be invited */
  readonly inviteCandidates = computed(() => {
    const me = this.myEmail();
    const q = this.whMemberSearch().trim().toLowerCase();
    return this.allUsers()
      .filter((u) => !u.blocked && u.email !== me)
      .filter((u) => !q || u.email.includes(q) || u.name.toLowerCase().includes(q))
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  });

  openCreateWh(): void {
    this.whName.set('');
    this.whMembers.set(new Set());
    this.whMemberSearch.set('');
    this.whDialog.set('create');
  }
  openManageWh(w: Warehouse): void {
    this.whName.set(w.name);
    this.whMembers.set(new Set(w.members.filter((m) => m !== w.ownerEmail)));
    this.whMemberSearch.set('');
    this.whDialog.set(w);
  }
  closeWhDialog(): void {
    this.whDialog.set(null);
  }
  toggleWhMember(email: string): void {
    const next = new Set(this.whMembers());
    next.has(email) ? next.delete(email) : next.add(email);
    this.whMembers.set(next);
  }

  async saveWhDialog(): Promise<void> {
    const d = this.whDialog();
    if (!d || this.savingWh()) return;
    const name = this.whName().trim();
    if (!name) {
      this.toast('warn', 'Укажите название', '');
      return;
    }
    this.savingWh.set(true);
    try {
      if (d === 'create') {
        const id = await this.warehouse.createShared(name, this.myEmail(), [...this.whMembers()]);
        this.selectWarehouse(id);
        this.toast('success', 'Склад создан', name);
      } else {
        if (name !== d.name) await this.warehouse.renameShared(d.id, name);
        await this.warehouse.setMembers(d, [...this.whMembers()]);
        this.toast('success', 'Сохранено', name);
      }
      this.closeWhDialog();
    } catch (e) {
      this.toast('error', 'Ошибка', this.msg(e));
    } finally {
      this.savingWh.set(false);
    }
  }

  confirmDeleteWh(w: Warehouse): void {
    this.confirmationService.confirm({
      header: 'Удалить склад',
      message: `Удалить склад «${w.name}»? Все его ресурсы будут стёрты без возможности восстановления.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Удалить',
      rejectLabel: 'Отмена',
      acceptButtonStyleClass: 'p-button-danger',
      accept: async () => {
        try {
          await this.warehouse.deleteShared(w);
          this.closeWhDialog();
          this.toast('success', 'Склад удалён', w.name);
        } catch (e) {
          this.toast('error', 'Ошибка', this.msg(e));
        }
      },
    });
  }

  /* --------------------------------------------------------------- helpers */

  /** does this catalog row already sit on the stock, and how much */
  stockQtyFor(e: CraftEntry): number | null {
    const s = this.stock().find(
      (x) => (x.catalogId && x.catalogId === e.id) || normName(x.name) === normName(e.name),
    );
    return s ? s.qty : null;
  }

  catLabel(cat: string): string {
    return this.categoryLabel[cat as CraftCategory] ?? cat;
  }

  fmtTs(ts: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  private esc(s: string): string {
    return String(s ?? '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
    );
  }

  /** rich tooltip for the history button: every recorded change, newest first */
  lastChangeText(item: StockItem): string {
    if (!item.history.length) return 'Изменений ещё не было';
    const rows = item.history.map((h) => {
      const diff = h.to - h.from;
      const sign = diff > 0 ? '+' : '';
      return `<div><b>${this.esc(h.byName)}</b> ${h.from} → <b>${h.to}</b> <span style="opacity:.7">(${sign}${diff})</span> · ${this.fmtTs(h.ts)}</div>`;
    });
    return `<div style="text-align:left">${rows.join('')}</div>`;
  }

  imgError(e: Event): void {
    const el = e.target as HTMLImageElement | null;
    if (el) el.style.visibility = 'hidden';
  }

  trackStock = (_: number, i: StockItem) => i.id;
  trackEntry = (_: number, e: CraftEntry) => e.id;
  trackWh = (_: number, w: Warehouse) => w.id;
  trackUser = (_: number, u: SiteUser) => u.email;

  private toast(
    severity: 'success' | 'error' | 'info' | 'warn',
    summary: string,
    detail: string,
  ): void {
    this.messageService.add({
      severity,
      summary,
      detail,
      life: severity === 'error' ? 5000 : 2400,
    });
  }
  private msg(e: unknown): string {
    return e instanceof Error && e.message ? e.message : 'Что-то пошло не так';
  }
}
