import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ConfirmationService, MessageService } from 'primeng/api';
import { BadgeModule } from 'primeng/badge';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import {
  ConstPartyGroup,
  ConstPartyService,
  ConstPartyUser,
} from '../../services/const-party.service';
import { ClanAccessService } from '../../services/clan-access.service';
import { GearCatalogService } from '../../services/gear-catalog.service';
import { GradeBadgeComponent } from '../shared/grade-badge/grade-badge.component';
import { PlayerModalComponent } from './player-modal/player-modal.component';
import {
  CatalogItem,
  EQUIP_SLOTS,
  Grade,
  GRADES,
  GRADE_RANK,
  expandEquipment,
  levelGrade,
  raceName,
  roleColor,
} from '../../data/clan-mock-data';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    BadgeModule,
    ButtonModule,
    ConfirmDialogModule,
    DialogModule,
    InputTextModule,
    TagModule,
    TooltipModule,
    GradeBadgeComponent,
    PlayerModalComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './users.component.html',
  styleUrl: './users.component.scss',
})
export class UsersComponent {
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);
  private constPartyService = inject(ConstPartyService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private gearCatalog = inject(GearCatalogService);
  readonly access = inject(ClanAccessService);

  private readonly allItems = toSignal(this.gearCatalog.items$, {
    initialValue: [] as CatalogItem[],
  });
  private readonly itemMap = computed(() => new Map(this.allItems().map((it) => [it.id, it])));
  private itemById(id: string | null | undefined): CatalogItem | null {
    return id ? this.itemMap().get(id) ?? null : null;
  }

  readonly totalSlots = EQUIP_SLOTS.length;

  readonly groups = signal<ConstPartyGroup[]>([]);
  readonly selectedGroupId = signal<string | null>(null);
  readonly loading = signal(true);

  /** unified player modal — open with a user id, or `''` to create a new one */
  readonly modalUserId = signal<string | null>(null);
  readonly modalOpen = computed(() => this.modalUserId() !== null);

  /** twink group is collapsed by default */
  readonly twinksOpen = signal(false);
  toggleTwinks(): void {
    this.twinksOpen.update((v) => !v);
  }

  readonly sortedGroups = computed(() =>
    [...this.groups()].sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '')),
  );
  readonly selectedGroup = computed<ConstPartyGroup | null>(
    () => this.groups().find((g) => g.id === this.selectedGroupId()) ?? null,
  );
  readonly packsCount = computed(() => this.groups().length);
  readonly playersCount = computed(() =>
    this.groups().reduce((sum, g) => sum + (g.users?.length ?? 0), 0),
  );
  readonly mainsCount = computed(() =>
    this.groups().reduce((sum, g) => sum + (g.users ?? []).filter((u) => !u.isTwink).length, 0),
  );
  readonly twinksCount = computed(() =>
    this.groups().reduce((sum, g) => sum + (g.users ?? []).filter((u) => u.isTwink).length, 0),
  );
  readonly canManageSelected = computed(() => this.access.canManageMembers(this.selectedGroup()));

  /* -------------------------------------------------------------- pack CRUD */

  readonly showCreatePack = signal(false);
  readonly creatingPack = signal(false);
  readonly createPackForm = this.fb.nonNullable.group({
    displayName: ['', [Validators.required]],
    leaderName: [''],
  });

  readonly editingPackId = signal<string | null>(null);
  readonly savingPack = signal(false);
  readonly editPackForm = this.fb.nonNullable.group({
    displayName: ['', [Validators.required]],
  });

  constructor() {
    this.constPartyService
      .getGroups()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((groups) => {
        this.groups.set(groups ?? []);
        this.loading.set(false);

        const current = this.selectedGroupId();
        if (!current || !groups.some((g) => g.id === current)) {
          this.selectedGroupId.set(groups.length ? groups[0].id : null);
        }
      });

    // if my own character sits among the twinks of the open pack, reveal them
    effect(() => {
      const g = this.selectedGroup();
      if (g && (g.users ?? []).some((u) => u.isTwink && this.access.isSelf(u))) {
        this.twinksOpen.set(true);
      }
    });
  }

  trackByGroup = (_: number, g: ConstPartyGroup) => g.id;
  trackByUser = (_: number, u: ConstPartyUser) => u.id;
  raceName = raceName;
  roleColor = roleColor;
  levelGrade = levelGrade;

  selectGroup(group: ConstPartyGroup): void {
    this.selectedGroupId.set(group.id);
  }

  isPlHere(group: ConstPartyGroup): boolean {
    return this.access.isPlOf(group);
  }

  leaderOf(group: ConstPartyGroup): ConstPartyUser | null {
    return (group.users ?? []).find((u) => u.isPL) ?? null;
  }

  private orderMembers(list: ConstPartyUser[]): ConstPartyUser[] {
    return [...list].sort((a, b) => {
      if (a.isPL !== b.isPL) return a.isPL ? -1 : 1;
      return (b.level ?? 0) - (a.level ?? 0) || (a.name ?? '').localeCompare(b.name ?? '');
    });
  }

  /** non-twink members */
  mainMembers(group: ConstPartyGroup): ConstPartyUser[] {
    return this.orderMembers((group.users ?? []).filter((u) => !u.isTwink));
  }

  /** twink / alt characters */
  twinkMembers(group: ConstPartyGroup): ConstPartyUser[] {
    return this.orderMembers((group.users ?? []).filter((u) => u.isTwink));
  }

  /* -------- player modal -------- */

  openPlayer(user: ConstPartyUser): void {
    this.modalUserId.set(user.id);
  }

  openCreatePlayer(): void {
    if (!this.canManageSelected()) return;
    this.modalUserId.set('');
  }

  closePlayer(): void {
    this.modalUserId.set(null);
  }

  onPlayerSaved(id: string): void {
    // after "create", keep the modal open on the freshly created player
    if (id) this.modalUserId.set(id);
  }

  /* ------- gear summary shown in the member list ------- */

  /** slotId -> item for this user, with full-body armor mirrored into `legs` */
  private userItems(user: ConstPartyUser): CatalogItem[] {
    const eq = expandEquipment(user.equipment);
    return EQUIP_SLOTS.map((s) => this.itemById(eq[s.id])).filter((it): it is CatalogItem => !!it);
  }

  equippedCount(user: ConstPartyUser): number {
    return this.userItems(user).length;
  }

  gearScore(user: ConstPartyUser): number {
    return this.userItems(user).reduce((sum, it) => sum + GRADE_RANK[it.grade], 0);
  }

  /** the grade that makes up MORE than 50% of the equipped items, else null */
  dominantGrade(user: ConstPartyUser): Grade | null {
    return this.gradeBars(user).find((b) => b.pct > 50)?.grade ?? null;
  }

  /**
   * Per-grade breakdown of equipped items, D→S (only grades that occur).
   * `pct` is the share of ALL slots, so the bar fills to equippedCount/totalSlots
   * (e.g. 11/12 → ~92%, the rest stays as empty track).
   */
  gradeBars(user: ConstPartyUser): { grade: Grade; count: number; pct: number }[] {
    const items = this.userItems(user);
    const counts = {} as Record<Grade, number>;
    for (const g of GRADES) counts[g] = 0;
    for (const it of items) counts[it.grade]++;
    return GRADES.filter((g) => counts[g] > 0).map((g) => ({
      grade: g,
      count: counts[g],
      pct: (counts[g] / this.totalSlots) * 100,
    }));
  }

  /* --------------------------------------------------------- pack handlers */

  openCreatePack(): void {
    this.createPackForm.reset({ displayName: '', leaderName: '' });
    this.showCreatePack.set(true);
  }

  cancelCreatePack(): void {
    this.showCreatePack.set(false);
  }

  async createPack(): Promise<void> {
    if (this.creatingPack()) return;
    this.createPackForm.markAllAsTouched();
    if (this.createPackForm.invalid) return;

    this.creatingPack.set(true);
    const { displayName, leaderName } = this.createPackForm.getRawValue();
    try {
      const id = await this.constPartyService.createGroup(displayName, { name: leaderName });
      this.toast('success', 'Пак создан', displayName);
      this.showCreatePack.set(false);
      this.selectedGroupId.set(id);
    } catch (e) {
      this.toast('error', 'Ошибка', this.msg(e));
    } finally {
      this.creatingPack.set(false);
    }
  }

  startEditPack(group: ConstPartyGroup): void {
    this.editingPackId.set(group.id);
    this.editPackForm.setValue({ displayName: group.displayName ?? '' });
  }

  cancelEditPack(): void {
    this.editingPackId.set(null);
    this.savingPack.set(false);
  }

  async savePack(group: ConstPartyGroup): Promise<void> {
    if (this.savingPack()) return;
    this.editPackForm.markAllAsTouched();
    if (this.editPackForm.invalid) return;

    this.savingPack.set(true);
    try {
      await this.constPartyService.updateGroupDisplayName(
        group.id,
        this.editPackForm.getRawValue().displayName,
      );
      this.toast('success', 'Пак переименован', this.editPackForm.getRawValue().displayName);
      this.cancelEditPack();
    } catch (e) {
      this.toast('error', 'Ошибка', this.msg(e));
      this.savingPack.set(false);
    }
  }

  confirmDeletePack(group: ConstPartyGroup): void {
    this.confirmationService.confirm({
      header: 'Удалить пак',
      message: `Удалить пак «${group.displayName}» со всеми игроками?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Удалить',
      rejectLabel: 'Отмена',
      acceptButtonStyleClass: 'p-button-danger',
      accept: async () => {
        try {
          await this.constPartyService.deleteGroup(group.id);
          this.toast('success', 'Пак удалён', group.displayName);
        } catch (e) {
          this.toast('error', 'Ошибка', this.msg(e));
        }
      },
    });
  }

  /* ------------------------------------------------------- member handlers */

  confirmDeleteMember(user: ConstPartyUser): void {
    const group = this.selectedGroup();
    if (!group) return;
    this.confirmationService.confirm({
      header: 'Удалить игрока',
      message: `Удалить «${user.name}» из пака «${group.displayName}»?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Удалить',
      rejectLabel: 'Отмена',
      acceptButtonStyleClass: 'p-button-danger',
      accept: async () => {
        try {
          await this.constPartyService.removeUser(group.id, user.id);
          this.toast('success', 'Игрок удалён', user.name);
          if (this.modalUserId() === user.id) this.closePlayer();
        } catch (e) {
          this.toast('error', 'Ошибка', this.msg(e));
        }
      },
    });
  }

  /* ----------------------------------------------------------------- utils */

  private toast(severity: 'success' | 'error' | 'info', summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail, life: severity === 'error' ? 5000 : 2200 });
  }

  private msg(e: unknown): string {
    return e instanceof Error && e.message ? e.message : 'Что-то пошло не так';
  }
}
