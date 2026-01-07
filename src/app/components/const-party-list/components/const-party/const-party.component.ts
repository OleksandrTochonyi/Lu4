import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DividerModule } from 'primeng/divider';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import {
  ConstPartyGroup,
  ConstPartyService,
  ConstPartyUser,
} from '../../../../services/const-party.service';

@Component({
  selector: 'app-const-party',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    DividerModule,
    InputTextModule,
    DropdownModule,
    ButtonModule,
    TableModule,
    TagModule,
  ],
  templateUrl: './const-party.component.html',
  styleUrl: './const-party.component.scss',
})
export class ConstPartyComponent {
  private fb = inject(FormBuilder);
  private constPartyService = inject(ConstPartyService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);

  group = input.required<ConstPartyGroup>();

  isAdding = signal(false);
  showAddForm = signal(false);

  editingUser = signal<ConstPartyUser | null>(null);
  isEditing = signal(false);

  roleOptions = [
    { label: 'Простой смертный', value: 'user' },
    { label: 'Чел который за всех страдает [PL]', value: 'leader' },
  ];

  displayRole(user: ConstPartyUser): string | null {
    const role = (user?.role ?? '').toLowerCase();
    if (!role) return null;
    if (role === 'user') return null;
    if (role === 'leader') return 'Чел который за всех страдает [PL]';
    return user.role;
  }

  leaders = computed<ConstPartyUser[]>(() => {
    const users = this.group()?.users ?? [];
    if (!users.length) return [];
    return users.filter((u) => (u?.role ?? '').toLowerCase() === 'leader');
  });

  members = computed<ConstPartyUser[]>(() => {
    const users = this.group()?.users ?? [];
    if (!users.length) return [];
    return users.filter((u) => (u?.role ?? '').toLowerCase() !== 'leader');
  });

  allUsers = computed<ConstPartyUser[]>(() => {
    const users = this.group()?.users ?? [];
    return [...users].sort((a, b) => (a?.name ?? '').localeCompare(b?.name ?? ''));
  });

  addForm = this.fb.nonNullable.group({
    name: ['', [Validators.required]],
    role: ['user', [Validators.required]],
  });

  editForm = this.fb.nonNullable.group({
    name: ['', [Validators.required]],
    role: ['user', [Validators.required]],
  });

  startEdit(user: ConstPartyUser): void {
    this.editingUser.set(user);
    this.editForm.setValue({
      name: user?.name ?? '',
      role: (user?.role as any) ?? 'user',
    });
  }

  cancelEdit(): void {
    this.editingUser.set(null);
    this.isEditing.set(false);
    this.editForm.reset({ name: '', role: 'user' });
  }

  async saveEdit(): Promise<void> {
    if (this.isEditing()) return;
    this.editForm.markAllAsTouched();
    if (this.editForm.invalid) return;

    const group = this.group();
    const prev = this.editingUser();
    if (!group?.id || !prev) return;

    this.isEditing.set(true);
    const next = this.editForm.getRawValue();

    try {
      await this.constPartyService.updateUserInGroup(group.id, prev, next);
      this.messageService.add({
        severity: 'success',
        summary: 'Сохранено',
        detail: `${next.name} (${next.role})`,
        life: 2000,
      });
      this.cancelEdit();
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Failed to update user';
      this.messageService.add({
        severity: 'error',
        summary: 'Ошибка',
        detail: msg,
        life: 5000,
      });
    } finally {
      this.isEditing.set(false);
    }
  }

  async deleteUser(user: ConstPartyUser): Promise<void> {
    const group = this.group();
    if (!group?.id) return;

    // If deleting currently edited user, close editor
    const editing = this.editingUser();
    if (editing && editing.name === user.name && editing.role === user.role) {
      this.cancelEdit();
    }

    try {
      await this.constPartyService.removeUserFromGroup(group.id, user);
      this.messageService.add({
        severity: 'success',
        summary: 'Удалено',
        detail: `${user.name} (${user.role})`,
        life: 2000,
      });
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Failed to delete user';
      this.messageService.add({
        severity: 'error',
        summary: 'Ошибка',
        detail: msg,
        life: 5000,
      });
    }
  }

  confirmDeleteUser(user: ConstPartyUser): void {
    const name = user?.name ?? 'этого пользователя';
    this.confirmationService.confirm({
      header: 'Подтверждение удаления',
      message: `Вы точно уверены что вы хотите удалить "${name}" из группы?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Удалить',
      rejectLabel: 'Отмена',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        void this.deleteUser(user);
      },
    });
  }

  async addUser(): Promise<void> {
    if (this.isAdding()) return;

    this.addForm.markAllAsTouched();
    if (this.addForm.invalid) return;

    const group = this.group();
    if (!group?.id) return;

    this.isAdding.set(true);
    const { name, role } = this.addForm.getRawValue();

    try {
      await this.constPartyService.addUserToGroup(group.id, { name, role });
      this.addForm.reset();
      this.showAddForm.set(false);
      this.messageService.add({
        severity: 'success',
        summary: 'Добавлен участник',
        detail: `${name} (${role})`,
        life: 2500,
      });
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Failed to add user';
      this.messageService.add({
        severity: 'error',
        summary: 'Ошибка',
        detail: msg,
        life: 5000,
      });
    } finally {
      this.isAdding.set(false);
    }
  }

  cancelAdd(): void {
    this.addForm.reset();
    this.showAddForm.set(false);
  }
}
