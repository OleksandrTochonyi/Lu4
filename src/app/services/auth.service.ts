import { Injectable, inject } from '@angular/core';
import {
  Auth,
  User,
  authState,
  signInWithEmailAndPassword,
  signOut,
} from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private auth = inject(Auth);

  private readonly storageKey = 'lu4_auth';

  readonly user$: Observable<User | null> = authState(this.auth);

  // Admin check: the user's email contains "admin" (case-insensitive). No separate role storage.
  readonly isAdmin$: Observable<boolean> = this.user$.pipe(
    map((user) => String(user?.email ?? '').toLowerCase().includes('admin'))
  );

  login(email: string, password: string) {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  storeCredentials(email: string, password: string): void {
    localStorage.setItem(this.storageKey, JSON.stringify({ email, password }));
  }

  clearStoredCredentials(): void {
    localStorage.removeItem(this.storageKey);
  }

  getStoredCredentials(): { email: string; password: string } | null {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const email = typeof parsed?.email === 'string' ? parsed.email : null;
      const password =
        typeof parsed?.password === 'string' ? parsed.password : null;
      if (!email || !password) return null;
      return { email, password };
    } catch {
      return null;
    }
  }

  async tryAutoLoginFromStorage(): Promise<boolean> {
    const creds = this.getStoredCredentials();

    if (!creds) {
      if (this.auth.currentUser) {
        await signOut(this.auth);
      }
      return false;
    }

    if (this.auth.currentUser) return true;

    try {
      await this.login(creds.email, creds.password);
      return true;
    } catch {
      this.clearStoredCredentials();
      return false;
    }
  }

  logout() {
    this.clearStoredCredentials();
    return signOut(this.auth);
  }
}
