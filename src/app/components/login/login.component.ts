import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { MessageService } from 'primeng/api';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';

import { AuthService } from '../../services/auth.service';
import { SiteUsersService } from '../../services/site-users.service';

@Component({
  selector: 'app-login',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    InputTextModule,
    PasswordModule,
    ButtonModule,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private siteUsers = inject(SiteUsersService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private messageService = inject(MessageService);

  isSubmitting = false;

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    if (qp.get('blocked')) {
      this.messageService.add({
        severity: 'error',
        summary: 'Доступ заблокирован',
        detail: 'Ваш аккаунт заблокирован администратором.',
        life: 6000,
      });
    } else if (qp.get('denied')) {
      this.messageService.add({
        severity: 'error',
        summary: 'Нет доступа',
        detail: 'Этого аккаунта нет в списке доступа. Обратитесь к администратору.',
        life: 6000,
      });
    }
  }

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  async submit(): Promise<void> {
    if (this.isSubmitting) return;

    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.isSubmitting = true;
    const { email, password } = this.form.getRawValue();

    try {
      await this.authService.login(email, password);

      // Firebase Auth succeeded — but the access list may still say no. Wait for
      // auth state to catch up, then check before anything welcoming happens.
      await firstValueFrom(this.authService.user$.pipe(filter((u) => !!u), take(1)));
      const reason = await firstValueFrom(this.siteUsers.deniedReason$.pipe(take(1)));
      if (reason) {
        await this.authService.logout();
        this.messageService.add({
          severity: 'error',
          summary: reason === 'blocked' ? 'Учётная запись заблокирована' : 'Нет доступа',
          detail: 'Учётная запись не активна. Обратитесь к администратору.',
          life: 7000,
        });
        return;
      }

      this.authService.storeCredentials(email, password);
      void this.siteUsers.markSeen(email);
      this.messageService.add({
        severity: 'success',
        summary: 'Залогинился? Красава!',
        detail: 'А теперь иди чекать рб, хули ты тут текст читаешь..',
        life: 4000,
      });
      await this.router.navigateByUrl('/');
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Login failed';
      this.messageService.add({
        severity: 'error',
        summary: 'Login failed',
        detail: msg,
        life: 5000,
      });
    } finally {
      this.isSubmitting = false;
    }
  }
}
