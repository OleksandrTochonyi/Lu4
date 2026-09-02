import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService, MessageService } from 'primeng/api';

import { GradeBadgeComponent } from '../shared/grade-badge/grade-badge.component';
import { CraftDetailComponent } from './craft-detail/craft-detail.component';
import {
  CRAFT_CATEGORY_LABEL,
  CraftCatalogService,
  CraftCategory,
  CraftEntry,
  CraftGrade,
  normName,
} from '../../services/craft-catalog.service';
import { StockItem, WarehouseService } from '../../services/warehouse.service';

interface CatalogSuggestion {
  id: string;
  name: string;
  icon?: string;
  grade: string | null;
  category: string;
  label: string;
}

@Component({
  selector: 'app-warehouse',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AutoCompleteModule,
    ButtonModule,
    ConfirmDialogModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    TooltipModule,
    GradeBadgeComponent,
    CraftDetailComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './warehouse.component.html',
  styleUrl: './warehouse.component.scss',
})
export class WarehouseComponent {
  private warehouse = inject(WarehouseService);
  private craftCatalog = inject(CraftCatalogService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);

  readonly categoryLabel = CRAFT_CATEGORY_LABEL;
  // craftable categories worth showing — "Прочее" (other) is hidden
  readonly categories: CraftCategory[] = ['weapon', 'armor', 'jewelry', 'resource'];
  // grades offered / kept in the craft catalogue — NG, D and S are dropped
  readonly craftGrades: CraftGrade[] = ['C', 'B', 'A'];
  private readonly hiddenCraftGrades = new Set<CraftGrade>(['NG', 'D', 'S']);
  private readonly hiddenCraftCategories = new Set<CraftCategory>(['other']);

  readonly view = signal<'stock' | 'craft'>('stock');

  /* ------------------------------------------------------------------ data */

  readonly stock = toSignal(this.warehouse.stock$, { initialValue: [] as StockItem[] });
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
  readonly stockResources = computed(() =>
    this.filteredStock().filter((i) => i.category !== 'part' && i.category !== 'recipe'),
  );
  readonly recipesOpen = signal(true);
  readonly partsOpen = signal(true);
  readonly resOpen = signal(true);

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
      await this.warehouse.setQty(item.id, next);
      this.toast('success', 'Количество обновлено', `${item.name}: ${item.qty} → ${next}`);
      this.cancelEdit();
    } catch (e) {
      this.toast('error', 'Ошибка', this.msg(e));
    } finally {
      this.savingQty.set(false);
    }
  }
  async bump(item: StockItem, delta: number): Promise<void> {
    const next = Math.max(0, item.qty + delta);
    if (next === item.qty) return;
    try {
      await this.warehouse.setQty(item.id, next);
    } catch (e) {
      this.toast('error', 'Ошибка', this.msg(e));
    }
  }

  /* history dialog */
  readonly historyItem = signal<StockItem | null>(null);
  openHistory(item: StockItem): void {
    this.historyItem.set(item);
  }
  closeHistory(): void {
    this.historyItem.set(null);
  }

  /* add dialog */
  readonly addOpen = signal(false);
  readonly adding = signal(false);
  readonly addName = signal('');
  readonly addQty = signal(0);
  readonly addPick = signal<CatalogSuggestion | null>(null);
  readonly addSuggestions = signal<CatalogSuggestion[]>([]);

  openAdd(): void {
    this.addName.set('');
    this.addQty.set(0);
    this.addPick.set(null);
    this.addSuggestions.set([]);
    this.addOpen.set(true);
  }
  closeAdd(): void {
    this.addOpen.set(false);
  }

  searchCatalog(ev: { query: string }): void {
    const q = normName(ev.query);
    if (!q) {
      this.addSuggestions.set([]);
      return;
    }
    const hits: CatalogSuggestion[] = [];
    for (const e of this.catalog()) {
      // the warehouse holds raw resources, crafting parts ("кучки") and
      // gear recipes (weapon / armor / jewelry, grade C and up) — no gear itself
      if (e.category === 'recipe') {
        if (!/^(?:weapon|armor|jewelry)-recipes-(?:C|B|A|S)$/i.test(e.section)) continue;
      } else if (e.category !== 'resource' && e.category !== 'part') {
        continue;
      }
      if (normName(e.name).includes(q)) {
        hits.push({
          id: e.id,
          name: e.name,
          icon: e.icon,
          grade: e.grade,
          category: e.category,
          label: `${e.name} · ${this.categoryLabel[e.category]}`,
        });
        if (hits.length >= 25) break;
      }
    }
    this.addSuggestions.set(hits);
  }

  onPick(ev: any): void {
    const s: CatalogSuggestion | null = ev?.value ?? ev ?? null;
    this.addPick.set(s && typeof s === 'object' ? s : null);
    if (s && typeof s === 'object') this.addName.set(s.name);
  }

  onAddNameInput(v: string | CatalogSuggestion): void {
    if (typeof v === 'string') {
      this.addName.set(v);
      this.addPick.set(null);
    }
  }

  readonly addDuplicate = computed(() => {
    const pick = this.addPick();
    const name = normName(this.addName());
    return this.stock().find((s) =>
      pick?.id && s.catalogId ? s.catalogId === pick.id : normName(s.name) === name,
    );
  });

  async submitAdd(): Promise<void> {
    if (this.adding()) return;
    const name = this.addName().trim();
    if (!name) {
      this.toast('warn', 'Укажите название', '');
      return;
    }
    if (this.addDuplicate()) {
      this.toast('warn', 'Уже на складе', 'Измените количество в таблице');
      return;
    }
    const pick = this.addPick();
    this.adding.set(true);
    try {
      await this.warehouse.addItem({
        name,
        catalogId: pick?.id ?? null,
        icon: pick?.icon ?? null,
        grade: pick?.grade ?? null,
        category: pick ? this.catalog().find((e) => e.id === pick.id)?.category ?? null : null,
        qty: Math.max(0, Math.round(Number(this.addQty()) || 0)),
      });
      this.toast('success', 'Добавлено на склад', name);
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
          await this.warehouse.remove(item.id);
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
