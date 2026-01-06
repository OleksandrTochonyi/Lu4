import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { MessageService } from 'primeng/api';

import { AuthService } from '../../services/auth.service';

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
export class LoginComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private messageService = inject(MessageService);

  isSubmitting = false;

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
      this.authService.storeCredentials(email, password);
      this.messageService.add({
        severity: 'success',
        summary: 'Залогинился? Красава!',
        detail: 'А теперь иди чекать рб, хули ты тут тескт читаешь..',
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
