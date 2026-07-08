import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TableModule } from 'primeng/table';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';

import { RaidBoss, RaidBossService } from '../../services/raid-boss.service';
import { Item, ItemsService, GRADE_ORDER } from '../../services/items.service';

interface RaidBossFormModel {
  name: string;
  level: number;
  imageUrl: string;
  infoLink: string;
  plusMinusRespTime: number;
  respTime: number;
  lastDeadTime: Date | null;
  loot: string[];
}

function emptyForm(): RaidBossFormModel {
  return {
    name: '',
    level: 1,
    imageUrl: '',
    infoLink: '',
    plusMinusRespTime: 4,
    respTime: 8,
    lastDeadTime: null,
    loot: [],
  };
}

@Component({
  selector: 'app-raid-boss-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    TableModule,
    MultiSelectModule,
    SelectModule,
  ],
  templateUrl: './raid-boss-list.component.html',
  styleUrl: './raid-boss-list.component.scss',
})
export class RaidBossListComponent {
  private destroyRef = inject(DestroyRef);
  private raidBossService = inject(RaidBossService);
  private itemsService = inject(ItemsService);
  private messageService = inject(MessageService);

  readonly bosses = signal<RaidBoss[]>([]);
  readonly loading = signal(true);

  readonly nameQuery = signal('');
  readonly levelFrom = signal<number | null>(null);
  readonly levelTo = signal<number | null>(null);

  readonly dialogVisible = signal(false);
  readonly isEditMode = signal(false);
  readonly saving = signal(false);
  readonly importingItems = signal(false);
  readonly confirmDeleteVisible = signal(false);
  readonly deleting = signal(false);
  private editingId = signal<string | null>(null);

  form = signal<RaidBossFormModel>(emptyForm());

  // Loot picker state
  readonly allItems = signal<Item[]>([]);
  readonly itemSearch = signal('');
  readonly gradeFilter = signal<string[]>([]);
  readonly itemSort = signal<'grade-desc' | 'grade-asc' | 'name'>('grade-desc');

  readonly gradeOptions = [
    { label: 'S', value: 's' },
    { label: 'A', value: 'a' },
    { label: 'B', value: 'b' },
    { label: 'C', value: 'c' },
    { label: 'D', value: 'd' },
    { label: 'Без грейда', value: 'none' },
  ];

  readonly sortOptions = [
    { label: 'Грейд S→D', value: 'grade-desc' },
    { label: 'Грейд D→S', value: 'grade-asc' },
    { label: 'Имя', value: 'name' },
  ];

  readonly bossCount = computed(() => this.bosses().length);

  readonly filteredBosses = computed(() => {
    const query = this.nameQuery().trim().toLowerCase();
    const from = this.levelFrom();
    const to = this.levelTo();

    return this.bosses().filter((boss) => {
      const matchesName = !query || (boss.name ?? '').toLowerCase().includes(query);
      const level = boss.level ?? 0;
      const matchesFrom = from == null || level >= from;
      const matchesTo = to == null || level <= to;
      return matchesName && matchesFrom && matchesTo;
    });
  });

  readonly filteredItems = computed(() => {
    const query = this.itemSearch().trim().toLowerCase();
    const grades = this.gradeFilter();
    const sort = this.itemSort();

    const list = this.allItems().filter((item) => {
      const matchesName = !query || (item.name ?? '').toLowerCase().includes(query);
      const matchesGrade = !grades.length || grades.includes(item.grade ?? 'none');
      return matchesName && matchesGrade;
    });

    return [...list].sort((a, b) => {
      switch (sort) {
        case 'name':
          return (a.name ?? '').localeCompare(b.name ?? '');
        case 'grade-asc':
          return (GRADE_ORDER[a.grade] ?? -1) - (GRADE_ORDER[b.grade] ?? -1);
        case 'grade-desc':
        default:
          return (GRADE_ORDER[b.grade] ?? -1) - (GRADE_ORDER[a.grade] ?? -1);
      }
    });
  });

  readonly selectedItems = computed(() => {
    const ids = new Set(this.form().loot);
    return this.allItems().filter((item) => ids.has(item.id));
  });

  constructor() {
    this.raidBossService
      .getRaidBosses()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          const sorted = (list ?? [])
            .slice()
            .sort((a, b) => (a?.level ?? 0) - (b?.level ?? 0) || (a?.name ?? '').localeCompare(b?.name ?? ''));
          this.bosses.set(sorted);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });

    this.itemsService
      .getItems()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => this.allItems.set(items ?? []));
  }

  trackById(_index: number, boss: RaidBoss): string {
    return boss.id;
  }

  trackItem(_index: number, item: Item): string {
    return item.id;
  }

  resetFilters(): void {
    this.nameQuery.set('');
    this.levelFrom.set(null);
    this.levelTo.set(null);
  }

  toDate(boss: RaidBoss): Date | null {
    const ts = boss?.lastDeadTime as any;
    if (!ts) return null;
    return typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  }

  openCreate(): void {
    this.isEditMode.set(false);
    this.editingId.set(null);
    this.form.set(emptyForm());
    this.itemSearch.set('');
    this.gradeFilter.set([]);
    this.dialogVisible.set(true);
  }

  openEdit(boss: RaidBoss): void {
    this.isEditMode.set(true);
    this.editingId.set(boss.id);
    this.form.set({
      name: boss.name ?? '',
      level: boss.level ?? 1,
      imageUrl: boss.meta?.imageUrl ?? '',
      infoLink: boss.meta?.infoLink ?? '',
      plusMinusRespTime: boss.meta?.plusMinusRespTime ?? 4,
      respTime: boss.meta?.respTime ?? 8,
      lastDeadTime: this.toDate(boss),
      loot: (boss.loot ?? []).map((ref) => (ref as any)?.id).filter(Boolean),
    });
    this.itemSearch.set('');
    this.gradeFilter.set([]);
    this.dialogVisible.set(true);
  }

  closeDialog(): void {
    this.dialogVisible.set(false);
  }

  async importItems(): Promise<void> {
    if (this.importingItems()) return;

    this.importingItems.set(true);
    this.messageService.add({
      severity: 'info',
      summary: 'Импорт предметов запущен',
      detail: 'Это может занять время…',
      life: 3000,
    });

    try {
      const count = await this.itemsService.importItemsFromApi('etcitem');
      this.messageService.add({
        severity: 'success',
        summary: 'Предметы импортированы',
        detail: `Сохранено: ${count}`,
        life: 4000,
      });
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Не удалось импортировать';
      this.messageService.add({ severity: 'error', summary: 'Ошибка', detail: msg, life: 5000 });
    } finally {
      this.importingItems.set(false);
    }
  }

  isSelected(itemId: string): boolean {
    return this.form().loot.includes(itemId);
  }

  toggleItem(itemId: string): void {
    this.form.update((f) => {
      const loot = f.loot.includes(itemId)
        ? f.loot.filter((x) => x !== itemId)
        : [...f.loot, itemId];
      return { ...f, loot };
    });
  }

  async save(): Promise<void> {
    if (this.saving()) return;

    const value = this.form();
    const name = (value.name ?? '').trim();

    if (!name) {
      this.messageService.add({ severity: 'warn', summary: 'Укажите имя босса', life: 3000 });
      return;
    }

    this.saving.set(true);
    const input = {
      name,
      level: value.level ?? 0,
      meta: {
        imageUrl: (value.imageUrl ?? '').trim(),
        infoLink: (value.infoLink ?? '').trim(),
        plusMinusRespTime: value.plusMinusRespTime ?? 0,
        respTime: value.respTime ?? 0,
      },
      lastDeadTime: value.lastDeadTime ?? null,
      lootItemIds: value.loot ?? [],
    };

    try {
      const editId = this.editingId();
      if (this.isEditMode() && editId) {
        await this.raidBossService.upsertRaidBoss(editId, input);
      } else {
        await this.raidBossService.createRaidBoss(input);
      }

      this.messageService.add({
        severity: 'success',
        summary: this.isEditMode() ? 'Босс обновлён' : 'Босс создан',
        detail: name,
        life: 2500,
      });
      this.dialogVisible.set(false);
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Не удалось сохранить';
      this.messageService.add({ severity: 'error', summary: 'Ошибка', detail: msg, life: 5000 });
    } finally {
      this.saving.set(false);
    }
  }

  updateForm<K extends keyof RaidBossFormModel>(key: K, value: RaidBossFormModel[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  askDelete(): void {
    if (!this.editingId()) return;
    this.confirmDeleteVisible.set(true);
  }

  cancelDelete(): void {
    this.confirmDeleteVisible.set(false);
  }

  async confirmDelete(): Promise<void> {
    const id = this.editingId();
    if (!id || this.deleting()) return;

    this.deleting.set(true);
    try {
      await this.raidBossService.deleteRaidBoss(id);
      this.messageService.add({
        severity: 'success',
        summary: 'Босс удалён',
        detail: this.form().name,
        life: 2500,
      });
      this.confirmDeleteVisible.set(false);
      this.dialogVisible.set(false);
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Не удалось удалить';
      this.messageService.add({ severity: 'error', summary: 'Ошибка', detail: msg, life: 5000 });
    } finally {
      this.deleting.set(false);
    }
  }
}
