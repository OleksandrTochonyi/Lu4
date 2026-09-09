import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';

import { AuthService } from '../../services/auth.service';
import { SiteRole, SiteUser, SiteUsersService } from '../../services/site-users.service';
import { ActivityEntry, ActivityLogService } from '../../services/activity-log.service';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    DropdownModule,
    DialogModule,
    TooltipModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.scss',
})
export class AdminUsersComponent {
  private siteUsers = inject(SiteUsersService);
  private auth = inject(AuthService);
  private activityLog = inject(ActivityLogService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);

  readonly activity = toSignal(this.activityLog.recent$, { initialValue: [] as ActivityEntry[] });
  readonly activityNav = toSignal(this.activityLog.recentNav$, { initialValue: [] as ActivityEntry[] });

  readonly users = toSignal(this.siteUsers.siteUsers$, { initialValue: [] as SiteUser[] });
  readonly myEmail = toSignal(
    this.auth.user$.pipe(map((u) => String(u?.email ?? '').trim().toLowerCase())),
    { initialValue: '' },
  );

  readonly roleOptions = [
    { label: 'КП', value: 'kp' as SiteRole },
    { label: 'Наёмник', value: 'merc' as SiteRole },
    { label: 'Администратор', value: 'admin' as SiteRole },
  ];

  readonly search = signal('');
  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return this.users();
    return this.users().filter(
      (u) => u.email.includes(q) || u.name.toLowerCase().includes(q) || u.note.toLowerCase().includes(q),
    );
  });

  readonly stats = computed(() => {
    const list = this.users();
    return {
      total: list.length,
      admins: list.filter((u) => u.role === 'admin' && !u.blocked).length,
      blocked: list.filter((u) => u.blocked).length,
    };
  });
  private readonly activeAdminCount = computed(() => this.stats().admins);

  isMe(u: SiteUser): boolean {
    return u.email === this.myEmail();
  }
  roleLabel(role: SiteRole): string {
    return role === 'admin' ? 'Админ' : role === 'merc' ? 'Наёмник' : 'КП';
  }
  fmtDate(ts: number): string {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  trackByUser = (_: number, u: SiteUser) => u.email;

  private toast(severity: 'success' | 'error' | 'warn', summary: string, detail = ''): void {
    this.messageService.add({ severity, summary, detail, life: severity === 'error' ? 5000 : 2600 });
  }
  private msg(e: unknown): string {
    return e instanceof Error && e.message ? e.message : 'Что-то пошло не так';
  }

  /* ----------------------------------------------------------- blocked ------- */

  toggleBlocked(u: SiteUser): void {
    const block = !u.blocked;
    const run = async () => {
      try {
        await this.siteUsers.setBlocked(u.email, block);
        this.toast('success', block ? 'Заблокирован' : 'Разблокирован', u.email);
      } catch (e) {
        this.toast('error', 'Ошибка', this.msg(e));
      }
    };
    if (!block) {
      void run();
      return;
    }
    this.confirmationService.confirm({
      header: 'Заблокировать доступ',
      message: this.isMe(u)
        ? 'Вы блокируете самого себя — вас сразу выкинет из системы.'
        : `Заблокировать «${u.email}»? Его выкинет из системы, и войти он больше не сможет.`,
      icon: 'pi pi-ban',
      acceptLabel: 'Заблокировать',
      rejectLabel: 'Отмена',
      acceptButtonStyleClass: 'p-button-danger',
      accept: run,
    });
  }

  /* ------------------------------------------------------------ delete ------- */

  confirmDelete(u: SiteUser): void {
    this.confirmationService.confirm({
      header: 'Убрать из списка',
      message:
        `Убрать «${u.email}» из списка доступа? Он сразу потеряет доступ к сайту` +
        ' (записи в списке больше нет — значит и входа нет). Аккаунт в Firebase при этом остаётся.',
      icon: 'pi pi-trash',
      acceptLabel: 'Убрать',
      rejectLabel: 'Отмена',
      acceptButtonStyleClass: 'p-button-danger',
      accept: async () => {
        try {
          await this.siteUsers.remove(u.email);
          this.toast('success', 'Убран из списка', u.email);
        } catch (e) {
          this.toast('error', 'Ошибка', this.msg(e));
        }
      },
    });
  }

  /* -------------------------------------------------------- add dialog ------- */

  readonly addOpen = signal(false);
  readonly savingAdd = signal(false);
  readonly addEmail = signal('');
  readonly addName = signal('');
  readonly addNote = signal('');
  readonly addRole = signal<SiteRole>('kp');

  openAdd(): void {
    this.addEmail.set('');
    this.addName.set('');
    this.addNote.set('');
    this.addRole.set('kp');
    this.addOpen.set(true);
  }
  closeAdd(): void {
    this.addOpen.set(false);
  }
  async submitAdd(): Promise<void> {
    if (this.savingAdd()) return;
    const email = this.addEmail().trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.toast('warn', 'Некорректный email', '');
      return;
    }
    if (this.users().some((u) => u.email === email)) {
      this.toast('warn', 'Такой пользователь уже есть', email);
      return;
    }
    this.savingAdd.set(true);
    try {
      await this.siteUsers.addUser(email, this.addRole(), this.addName(), this.addNote(), this.myEmail());
      this.toast('success', 'Добавлен', email);
      this.closeAdd();
    } catch (e) {
      this.toast('error', 'Ошибка', this.msg(e));
    } finally {
      this.savingAdd.set(false);
    }
  }

  /* ------------------------------------------------------- edit dialog ------- */

  readonly editOpen = signal(false);
  readonly savingEdit = signal(false);
  private editOrig: SiteUser | null = null;
  readonly editOrigEmail = signal('');
  readonly editEmail = signal('');
  readonly editName = signal('');
  readonly editNote = signal('');
  readonly editRole = signal<SiteRole>('kp');

  /** editing your own row — role is locked to admin, email is locked (tied to the Firebase account) */
  readonly editIsSelf = computed(() => this.editOrigEmail() === this.myEmail());

  openEdit(u: SiteUser): void {
    this.editOrig = u;
    this.editOrigEmail.set(u.email);
    this.editEmail.set(u.email);
    this.editName.set(u.name);
    this.editNote.set(u.note);
    this.editRole.set(u.role);
    this.editOpen.set(true);
  }
  closeEdit(): void {
    this.editOpen.set(false);
    this.editOrig = null;
  }
  async submitEdit(): Promise<void> {
    if (this.savingEdit() || !this.editOrig) return;
    const oldEmail = this.editOrigEmail();
    const newEmail = this.editEmail().trim().toLowerCase();
    const newRole: SiteRole = this.editIsSelf() ? 'admin' : this.editRole();
    const emailChanged = newEmail !== oldEmail;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      this.toast('warn', 'Некорректный email', '');
      return;
    }
    if (this.editIsSelf() && emailChanged) {
      this.toast('warn', 'Свою почту менять нельзя', 'Она привязана к аккаунту Firebase');
      return;
    }
    if (emailChanged && this.users().some((u) => u.email === newEmail)) {
      this.toast('warn', 'Пользователь с такой почтой уже есть', newEmail);
      return;
    }

    const merged: SiteUser = {
      ...this.editOrig,
      email: newEmail,
      role: newRole,
      name: this.editName(),
      note: this.editNote(),
    };

    const run = async () => {
      this.savingEdit.set(true);
      try {
        await this.siteUsers.saveUser(oldEmail, merged);
        this.toast('success', 'Сохранено', newEmail);
        this.closeEdit();
      } catch (e) {
        this.toast('error', 'Ошибка', this.msg(e));
      } finally {
        this.savingEdit.set(false);
      }
    };

    const demotingLastAdmin =
      this.editOrig.role === 'admin' && newRole !== 'admin' && this.activeAdminCount() <= 1;
    if (demotingLastAdmin) {
      this.confirmationService.confirm({
        header: 'Снять последнего администратора',
        message: 'Это последний активный админ. Пока админов нет, права получит любой из списка.',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Всё равно снять',
        rejectLabel: 'Отмена',
        acceptButtonStyleClass: 'p-button-danger',
        accept: () => void run(),
      });
      return;
    }
    void run();
  }

  /* ---------------------------------------------------- history dialog ------- */

  readonly historyOpen = signal(false);
  readonly historyUser = signal<SiteUser | null>(null);
  /** which slice of the log the dialog is showing */
  readonly historyTab = signal<'action' | 'nav'>('action');

  /** last 50 data changes (add / edit / delete / …) of the selected user */
  readonly historyActions = computed(() => {
    const u = this.historyUser();
    if (!u) return [] as ActivityEntry[];
    return this.activity().filter((e) => e.actor === u.email).slice(0, 50);
  });
  /** last 50 tab visits of the selected user — a separate collection, so it never
   *  competes with the actions above */
  readonly historyNav = computed(() => {
    const u = this.historyUser();
    if (!u) return [] as ActivityEntry[];
    return this.activityNav().filter((e) => e.actor === u.email).slice(0, 50);
  });
  /** rows for the tab that's currently selected */
  readonly historyEntries = computed(() =>
    this.historyTab() === 'nav' ? this.historyNav() : this.historyActions(),
  );

  openHistory(u: SiteUser): void {
    this.historyUser.set(u);
    this.historyTab.set('action');
    this.historyOpen.set(true);
  }
  closeHistory(): void {
    this.historyOpen.set(false);
    this.historyUser.set(null);
  }
}
