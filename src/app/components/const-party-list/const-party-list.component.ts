import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { AccordionModule } from 'primeng/accordion';
import { BadgeModule } from 'primeng/badge';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { OverlayPanel, OverlayPanelModule } from 'primeng/overlaypanel';

import {
  ConstPartyGroup,
  ConstPartyService,
} from '../../services/const-party.service';
import { ConstPartyComponent } from './components/const-party/const-party.component';

@Component({
  selector: 'app-const-party-list',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputTextModule,
    ButtonModule,
    AccordionModule,
    BadgeModule,
    ConfirmDialogModule,
    OverlayPanelModule,
    ConstPartyComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './const-party-list.component.html',
  styleUrl: './const-party-list.component.scss',
})
export class ConstPartyListComponent {
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);
  private constPartyService = inject(ConstPartyService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);

  isCreating = signal(false);
  showCreateForm = signal(false);
  groups = signal<ConstPartyGroup[]>([]);

  selectedGroupId = signal<string | null>(null);

  groupCount = computed(() => (this.groups() ?? []).length);
  peopleCount = computed(() =>
    (this.groups() ?? []).reduce((sum, group) => sum + (group?.users?.length ?? 0), 0)
  );

  private infoHideTimeoutId: ReturnType<typeof setTimeout> | null = null;

  editingGroupId = signal<string | null>(null);
  isGroupSaving = signal(false);
  editGroupForm = this.fb.nonNullable.group({
    displayName: ['', [Validators.required]],
  });

  sortedGroups = computed(() => {
    const list = this.groups() ?? [];
    return [...list].sort((a, b) => (a?.displayName ?? '').localeCompare(b?.displayName ?? ''));
  });

  selectedGroup = computed<ConstPartyGroup | null>(() => {
    const id = this.selectedGroupId();
    if (!id) return null;
    return (this.groups() ?? []).find((g) => g?.id === id) ?? null;
  });

  trackByGroupId(_index: number, group: ConstPartyGroup): string {
    return group.id;
  }

  createForm = this.fb.nonNullable.group({
    displayName: ['', [Validators.required]],
    leaderName: ['', [Validators.required]],
  });

  constructor() {
    this.constPartyService
      .getGroups()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((groups) => {
        const next = groups ?? [];
        this.groups.set(next);

        const currentId = this.selectedGroupId();
        const stillExists = currentId != null && next.some((g) => g?.id === currentId);
        if (stillExists) return;

        this.selectedGroupId.set(next.length ? next[0].id : null);
      });
  }

  selectGroup(group: ConstPartyGroup): void {
    if (!group?.id) return;
    this.selectedGroupId.set(group.id);
  }

  showInfo(event: Event, panel: OverlayPanel): void {
    this.cancelHideInfo();
    panel.show(event);
  }

  scheduleHideInfo(panel: OverlayPanel): void {
    this.cancelHideInfo();
    this.infoHideTimeoutId = setTimeout(() => panel.hide(), 150);
  }

  cancelHideInfo(): void {
    if (this.infoHideTimeoutId) {
      clearTimeout(this.infoHideTimeoutId);
      this.infoHideTimeoutId = null;
    }
  }

  async createGroup(): Promise<void> {
    if (this.isCreating()) return;

    this.createForm.markAllAsTouched();
    if (this.createForm.invalid) return;

    this.isCreating.set(true);
    const { displayName, leaderName } = this.createForm.getRawValue();

    try {
      await this.constPartyService.createGroup(displayName, {
        name: leaderName,
        role: 'leader',
      });
      this.messageService.add({
        severity: 'success',
        summary: 'Группа создана',
        detail: displayName,
        life: 2500,
      });
      this.createForm.reset();
      this.showCreateForm.set(false);
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Failed to create group';
      this.messageService.add({
        severity: 'error',
        summary: 'Ошибка',
        detail: msg,
        life: 5000,
      });
    } finally {
      this.isCreating.set(false);
    }
  }

  cancelCreate(): void {
    this.createForm.reset();
    this.showCreateForm.set(false);
  }

  startEditGroup(group: ConstPartyGroup): void {
    this.editingGroupId.set(group.id);
    this.editGroupForm.setValue({ displayName: group.displayName ?? '' });
  }

  cancelEditGroup(): void {
    this.editingGroupId.set(null);
    this.isGroupSaving.set(false);
    this.editGroupForm.reset({ displayName: '' });
  }

  async saveGroup(group: ConstPartyGroup): Promise<void> {
    if (this.isGroupSaving()) return;
    if (this.editingGroupId() !== group.id) return;

    this.editGroupForm.markAllAsTouched();
    if (this.editGroupForm.invalid) return;

    this.isGroupSaving.set(true);
    const { displayName } = this.editGroupForm.getRawValue();

    try {
      await this.constPartyService.updateGroupDisplayName(group.id, displayName);
      this.messageService.add({
        severity: 'success',
        summary: 'Группа обновлена',
        detail: displayName,
        life: 2000,
      });
      this.cancelEditGroup();
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Failed to update group';
      this.messageService.add({
        severity: 'error',
        summary: 'Ошибка',
        detail: msg,
        life: 5000,
      });
      this.isGroupSaving.set(false);
    }
  }

  async deleteGroup(group: ConstPartyGroup): Promise<void> {
    try {
      await this.constPartyService.deleteGroup(group.id);
      this.messageService.add({
        severity: 'success',
        summary: 'Группа удалена',
        detail: group.displayName,
        life: 2000,
      });
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Failed to delete group';
      this.messageService.add({
        severity: 'error',
        summary: 'Ошибка',
        detail: msg,
        life: 5000,
      });
    }
  }

  confirmDeleteGroup(group: ConstPartyGroup): void {
    const name = group?.displayName ?? 'эту группу';
    this.confirmationService.confirm({
      header: 'Подтверждение удаления',
      message: `Вы точно уверены что вы хотите удалить "${name}"?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Удалить',
      rejectLabel: 'Отмена',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        void this.deleteGroup(group);
      },
    });
  }
}
