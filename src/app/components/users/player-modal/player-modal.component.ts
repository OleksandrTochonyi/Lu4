import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import {
  ConstPartyGroup,
  ConstPartyService,
  ConstPartyUser,
} from '../../../services/const-party.service';
import { ClanAccessService } from '../../../services/clan-access.service';
import { GearCatalogService } from '../../../services/gear-catalog.service';
import {
  CATEGORY_LABEL,
  CHEST_FULLBODY_KEY,
  CatalogItem,
  COMBAT_ROLES,
  EQUIP_SLOTS,
  EquipSlot,
  Grade,
  GRADES,
  GRADE_RANK,
  MAX_ENCHANT,
  RACES,
  enchantColor,
  enchantKey,
  expandEquipment,
  isGrade,
  professionsForRace,
  raceName,
  readEnchant,
  slotAcceptsItem,
} from '../../../data/clan-mock-data';


@Component({
  selector: 'app-player-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputTextModule,
    TagModule,
    TooltipModule,
  ],
  templateUrl: './player-modal.component.html',
  styleUrl: './player-modal.component.scss',
})
export class PlayerModalComponent {
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);
  private constPartyService = inject(ConstPartyService);
  private gearCatalog = inject(GearCatalogService);
  private messageService = inject(MessageService);
  readonly access = inject(ClanAccessService);

  readonly group = input.required<ConstPartyGroup>();
  readonly userId = input<string | null>(null);

  readonly saved = output<string>();
  readonly requestClose = output<void>();

  readonly inventoryImg = 'assets/inventory-image.jpg';
  readonly slots = EQUIP_SLOTS;
  readonly grades = GRADES;
  readonly categoryLabel = CATEGORY_LABEL;
  readonly raceName = raceName;
  readonly raceOptions = RACES.map((r) => ({ label: r.name, value: r.id }));
  readonly roleOptions = COMBAT_ROLES.map((r) => ({ label: r, value: r }));

  readonly mode = computed<'create' | 'edit'>(() => (this.userId() ? 'edit' : 'create'));
  readonly user = computed<ConstPartyUser | null>(() => {
    const id = this.userId();
    return id ? this.group().users.find((u) => u.id === id) ?? null : null;
  });
  readonly canManage = computed(() => this.access.canManageMembers(this.group()));
  /** this is my own character and I'm not a manager → I may edit my level + gear only */
  readonly canSelfEdit = computed(
    () => !!this.userId() && !this.canManage() && this.access.isSelf(this.user()),
  );
  /** may change equipment: managers, or the player themselves */
  readonly canEditGear = computed(() => this.canManage() || this.canSelfEdit());

  readonly savingInfo = signal(false);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required]],
    email: ['', [Validators.email]],
    race: ['', [Validators.required]],
    profession: ['', [Validators.required]],
    level: [1, [Validators.required, Validators.min(1), Validators.max(85)]],
    role: ['', [Validators.required]],
    isPL: [false],
    isTwink: [false],
  });

  readonly selectedRaceId = signal('');
  readonly professionOptions = computed(() =>
    professionsForRace(this.selectedRaceId()).map((p) => ({ label: p, value: p })),
  );

  /* -------- gear -------- */

  readonly allItems = toSignal(this.gearCatalog.items$, { initialValue: [] as CatalogItem[] });
  private readonly itemMap = computed(() => new Map(this.allItems().map((it) => [it.id, it])));
  private readonly localEquip = signal<Record<string, string> | null>(null);

  readonly equipment = computed<Record<string, string>>(
    () => this.localEquip() ?? this.user()?.equipment ?? {},
  );
  readonly chestIsFullBody = computed(
    () => this.equipment()[CHEST_FULLBODY_KEY] === '1' && !!this.itemById(this.equipment()['chest']),
  );

  private buildRows(mirrorFullBody: boolean) {
    const eq = expandEquipment(this.equipment());
    return EQUIP_SLOTS.map((s) => {
      // display list shows a full-body chest as a single line (skip its legs echo);
      // the stat rows keep both so it still counts as 2 pieces
      if (!mirrorFullBody && s.id === 'legs' && this.chestIsFullBody()) return null;
      const item = this.itemById(eq[s.id]);
      if (!item) return null;
      const encFrom = s.id === 'legs' && this.chestIsFullBody() ? 'chest' : s.id;
      return { slot: s, item, ench: readEnchant(this.equipment(), encFrom) };
    }).filter((r): r is { slot: EquipSlot; item: CatalogItem; ench: number } => !!r);
  }

  /**
   * Rows for the "Надето" list, in a fixed order:
   * weapon → body (chest/legs) → helmet → gloves → boots → shield → jewelry.
   * A full-body chest is a single line (its legs echo is dropped in buildRows).
   */
  private static readonly LIST_ORDER: Record<string, number> = {
    weapon: 0,
    chest: 1,
    legs: 2,
    helmet: 3,
    gloves: 4,
    boots: 5,
    shield: 6,
    necklace: 7,
    medallion: 8,
    ring1: 9,
    ring2: 10,
    ring3: 11,
  };

  readonly equippedRows = computed(() => {
    const order = PlayerModalComponent.LIST_ORDER;
    return this.buildRows(false).sort(
      (a, b) => (order[a.slot.id] ?? 99) - (order[b.slot.id] ?? 99),
    );
  });

  /** which "Надето" groups are expanded (collapsed by default) */
  readonly openEqGroups = signal<Set<string>>(new Set());
  isEqGroupOpen(key: string): boolean {
    return this.openEqGroups().has(key);
  }
  toggleEqGroup(key: string): void {
    const next = new Set(this.openEqGroups());
    next.has(key) ? next.delete(key) : next.add(key);
    this.openEqGroups.set(next);
  }

  /** the "Надето" list split into Оружие / Броня / Бижутерия blocks */
  readonly equippedGroups = computed(() => {
    type Row = { slot: EquipSlot; item: CatalogItem; ench: number };
    const groups: { key: string; label: string; rows: Row[] }[] = [
      { key: 'weapon', label: 'Оружие', rows: [] },
      { key: 'armor', label: 'Броня', rows: [] },
      { key: 'jewelry', label: 'Бижутерия', rows: [] },
    ];
    for (const r of this.equippedRows()) {
      const g =
        r.item.category === 'weapon' ? groups[0] : r.item.category === 'jewelry' ? groups[2] : groups[1];
      g.rows.push(r);
    }
    return groups.filter((g) => g.rows.length);
  });

  /** rows for the aggregates — full-body armor counts as 2 pieces */
  private readonly statRows = computed(() => this.buildRows(true));

  /** enchant contribution to the gear score: +1 once an item reaches +3, then +1 per level beyond */
  private enchantBonus(level: number): number {
    return level >= 3 ? level - 2 : 0;
  }

  readonly gearScore = computed(() =>
    this.statRows().reduce(
      (sum, r) => sum + GRADE_RANK[r.item.grade] + this.enchantBonus(r.ench),
      0,
    ),
  );
  readonly gradeBreakdown = computed(() => {
    const counts: Record<Grade, number> = { D: 0, C: 0, B: 0, A: 0, S: 0 };
    for (const r of this.statRows()) counts[r.item.grade]++;
    return counts;
  });

  /* -------- picker -------- */

  readonly pickerSlot = signal<EquipSlot | null>(null);
  readonly pickerSearch = signal('');
  readonly pickerGrades = signal<Set<Grade>>(new Set());
  readonly pickerFullBody = signal(false);
  readonly pickerShowAll = signal(false);
  readonly savingPicker = signal(false);

  /** pending pick: undefined = untouched · null = will unequip · string = item id */
  readonly pickerSel = signal<string | null | undefined>(undefined);

  /** item id that is (or will be) in the slot — for the highlight */
  readonly pendingItemId = computed<string | null>(() => {
    const slot = this.pickerSlot();
    if (!slot) return null;
    const s = this.pickerSel();
    return s === undefined ? this.equipment()[slot.id] ?? null : s;
  });

  readonly pickerDirty = computed(() => {
    const slot = this.pickerSlot();
    if (!slot) return false;
    if (this.pickerSel() !== undefined) return true;
    return (
      !!slot.chest &&
      !!this.equipment()['chest'] &&
      this.pickerFullBody() !== this.chestIsFullBody()
    );
  });

  readonly pickerItems = computed<CatalogItem[]>(() => {
    const slot = this.pickerSlot();
    if (!slot) return [];
    const q = this.pickerSearch().trim().toLowerCase();
    const grades = this.pickerGrades();
    const showAll = this.pickerShowAll();

    const list = this.allItems().filter((it) => {
      if (!isGrade(it.grade)) return false;
      if (q && !it.name.toLowerCase().includes(q)) return false;
      if (grades.size && !grades.has(it.grade)) return false;
      return showAll ? it.category === slot.category : slotAcceptsItem(slot, it);
    });

    // catalogue order (alphabetical, from the service). When showing the whole
    // category, keep the items that actually fit this slot on top.
    if (showAll) {
      list.sort(
        (a, b) => (slotAcceptsItem(slot, a) ? 0 : 1) - (slotAcceptsItem(slot, b) ? 0 : 1),
      );
    }
    return list;
  });

  constructor() {
    // (re)load the form whenever we switch which player the modal shows
    effect(() => {
      this.userId();
      untracked(() => {
        this.localEquip.set(null);
        this.resetForm();
      });
    });

    // managers may edit everything; a player may edit only their own level;
    // everyone else sees a read-only form
    effect(() => {
      const full = this.canManage();
      const selfEdit = this.canSelfEdit();
      untracked(() => {
        if (full) {
          this.form.enable({ emitEvent: false });
        } else {
          this.form.disable({ emitEvent: false });
          if (selfEdit) this.form.controls.level.enable({ emitEvent: false });
        }
      });
    });

    this.form.controls.race.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((raceId) => {
        this.selectedRaceId.set(raceId ?? '');
        if (!professionsForRace(raceId ?? '').includes(this.form.controls.profession.value)) {
          this.form.controls.profession.setValue('');
        }
      });
  }

  private resetForm(): void {
    const id = this.userId();
    const u = this.user();
    // just created: the live stream has not delivered the new user yet — keep
    // whatever is already in the form instead of blanking it
    if (id && !u) return;
    this.form.reset({
      name: u?.name ?? '',
      email: u?.email ?? '',
      race: u?.race ?? '',
      profession: u?.profession ?? '',
      level: u?.level || 1,
      role: u?.role ?? '',
      isPL: !!u?.isPL,
      isTwink: !!u?.isTwink,
    });
    this.selectedRaceId.set(u?.race ?? '');
  }

  trackBySlot = (_: number, s: EquipSlot) => s.id;
  trackByItem = (_: number, it: CatalogItem) => it.id;
  trackByRow = (_: number, r: { slot: EquipSlot }) => r.slot.id;

  imgError(e: Event): void {
    const el = e.target as HTMLImageElement | null;
    if (el) el.style.display = 'none';
  }

  /* -------- info save -------- */

  async saveInfo(): Promise<void> {
    if (this.savingInfo() || (!this.canManage() && !this.canSelfEdit())) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.savingInfo.set(true);
    const value = this.form.getRawValue();
    try {
      if (this.mode() === 'create' && this.canManage()) {
        const id = await this.constPartyService.addUser(this.group().id, value);
        this.messageService.add({ severity: 'success', summary: 'Игрок создан', detail: value.name, life: 2000 });
        this.saved.emit(id);
      } else {
        await this.constPartyService.updateUser(this.group().id, this.userId()!, value);
        this.messageService.add({ severity: 'success', summary: 'Сохранено', detail: value.name, life: 1800 });
        this.saved.emit(this.userId()!);
      }
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Ошибка',
        detail: e instanceof Error ? e.message : '',
        life: 5000,
      });
    } finally {
      this.savingInfo.set(false);
    }
  }

  /* -------- slot helpers -------- */

  itemById(id: string | null | undefined): CatalogItem | null {
    return id ? this.itemMap().get(id) ?? null : null;
  }

  slotItem(slot: EquipSlot): CatalogItem | null {
    if (this.isLegsLocked(slot)) return this.itemById(this.equipment()['chest']);
    return this.itemById(this.equipment()[slot.id]);
  }

  isLegsLocked(slot: EquipSlot): boolean {
    return !!slot.legs && this.chestIsFullBody();
  }

  slotStateClass(slot: EquipSlot): string {
    if (this.isLegsLocked(slot)) return 'slot--locked';
    return this.slotItem(slot) ? 'slot--filled' : 'slot--empty';
  }

  gradeClass(grade: Grade | string | null | undefined): string {
    const g = String(grade ?? '').toUpperCase();
    return isGrade(g) ? `grade-${g.toLowerCase()}` : 'grade-none';
  }

  slotFits(item: CatalogItem): boolean {
    const slot = this.pickerSlot();
    return !!slot && slotAcceptsItem(slot, item);
  }

  /* -------- enchant -------- */

  readonly maxEnchant = MAX_ENCHANT;
  enchantColor = enchantColor;

  /** enchant level shown on a slot (legs mirrors the chest when full-body) */
  slotEnchant(slot: EquipSlot): number {
    const from = this.isLegsLocked(slot) ? 'chest' : slot.id;
    return readEnchant(this.equipment(), from);
  }

  readonly encSlot = signal<EquipSlot | null>(null);
  readonly encValue = signal(0);
  readonly savingEnc = signal(false);
  readonly encItemName = computed(
    () => this.itemById(this.equipment()[this.encSlot()?.id ?? ''])?.name ?? '',
  );

  openEnch(slot: EquipSlot): void {
    if (!this.canEditGear() || this.isLegsLocked(slot) || !this.slotItem(slot)) return;
    this.encSlot.set(slot);
    this.encValue.set(this.slotEnchant(slot));
  }

  closeEnch(): void {
    this.encSlot.set(null);
  }

  setEnc(n: number): void {
    const v = Math.max(0, Math.min(MAX_ENCHANT, Math.round(Number(n) || 0)));
    this.encValue.set(v);
  }

  async saveEnch(): Promise<void> {
    const slot = this.encSlot();
    if (!slot || this.savingEnc() || !this.canEditGear()) return;

    const next: Record<string, string> = { ...this.equipment() };
    const k = enchantKey(slot.id);
    if (this.encValue() > 0) next[k] = String(this.encValue());
    else delete next[k];

    this.savingEnc.set(true);
    try {
      await this.persist(next);
      this.messageService.add({ severity: 'success', summary: 'Заточка сохранена', life: 1400 });
      this.closeEnch();
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Не удалось сохранить',
        detail: e instanceof Error ? e.message : '',
        life: 5000,
      });
    } finally {
      this.savingEnc.set(false);
    }
  }

  /* -------- picker actions -------- */

  openPicker(slot: EquipSlot): void {
    if (!this.canEditGear() || !this.userId() || this.isLegsLocked(slot)) return;
    this.pickerSlot.set(slot);
    this.pickerSearch.set('');
    this.pickerGrades.set(new Set());
    this.pickerShowAll.set(false);
    this.pickerSel.set(undefined);
    this.pickerFullBody.set(slot.chest ? this.chestIsFullBody() : false);
  }

  closePicker(): void {
    this.pickerSlot.set(null);
  }

  toggleGrade(grade: Grade): void {
    const next = new Set(this.pickerGrades());
    next.has(grade) ? next.delete(grade) : next.add(grade);
    this.pickerGrades.set(next);
  }

  isGradeActive(grade: Grade): boolean {
    return this.pickerGrades().has(grade);
  }

  isEquippedInPicker(item: CatalogItem): boolean {
    return this.pendingItemId() === item.id;
  }

  pickItem(item: CatalogItem): void {
    // "Все предметы раздела" lets the user force-pick an item whose auto-detected
    // sub-type doesn't match this slot — that's intentional.
    if (!this.slotFits(item) && !this.pickerShowAll()) return;
    // click the already-selected item again to deselect it
    this.pickerSel.set(this.pendingItemId() === item.id ? null : item.id);
  }

  markUnequip(): void {
    this.pickerSel.set(null);
  }

  /** commit the pending pick + full-body toggle */
  async savePicker(): Promise<void> {
    const slot = this.pickerSlot();
    if (!slot || this.savingPicker() || !this.pickerDirty() || !this.canEditGear()) return;

    const next: Record<string, string> = { ...this.equipment() };
    const sel = this.pickerSel();

    if (sel === null) {
      delete next[slot.id];
      delete next[enchantKey(slot.id)];
      if (slot.chest) delete next[CHEST_FULLBODY_KEY];
    } else if (typeof sel === 'string') {
      // a different item goes in → its enchant starts fresh
      if (this.equipment()[slot.id] !== sel) delete next[enchantKey(slot.id)];
      next[slot.id] = sel;
    }

    if (slot.chest && next['chest']) {
      if (this.pickerFullBody()) {
        next[CHEST_FULLBODY_KEY] = '1';
        delete next['legs'];
      } else {
        delete next[CHEST_FULLBODY_KEY];
      }
    }

    this.savingPicker.set(true);
    try {
      await this.persist(next);
      this.messageService.add({ severity: 'success', summary: 'Сохранено', life: 1400 });
      this.closePicker();
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Не удалось сохранить',
        detail: e instanceof Error ? e.message : '',
        life: 5000,
      });
    } finally {
      this.savingPicker.set(false);
    }
  }

  private async persist(next: Record<string, string>): Promise<void> {
    const uid = this.userId();
    if (!uid) return;
    this.localEquip.set(next);
    try {
      await this.constPartyService.setEquipment(this.group().id, uid, next);
      setTimeout(() => this.localEquip.set(null), 400);
    } catch (e) {
      this.localEquip.set(null);
      throw e;
    }
  }
}
