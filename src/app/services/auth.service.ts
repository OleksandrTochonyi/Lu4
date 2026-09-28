import { Injectable, inject } from '@angular/core';
import {
  Auth,
  User,
  authState,
  signInWithEmailAndPassword,
  signOut,
} from '@angular/fire/auth';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private auth = inject(Auth);

  private readonly storageKey = 'lu4_auth';
  /** stored credentials expire a week after they were saved */
  private readonly ttlMs = 7 * 24 * 60 * 60 * 1000;

  readonly user$: Observable<User | null> = authState(this.auth);

  // Admin status lives in SiteUsersService now (Firestore `site-users` role), not here.

  login(email: string, password: string) {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  storeCredentials(email: string, password: string): void {
    localStorage.setItem(this.storageKey, JSON.stringify({ email, password, storedAt: Date.now() }));
  }

  clearStoredCredentials(): void {
    localStorage.removeItem(this.storageKey);
  }

  /**
   * Stored credentials are good for one week from when they were saved — past
   * that, they're wiped (here, on read) and the user has to log in again.
   */
  getStoredCredentials(): { email: string; password: string } | null {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const email = typeof parsed?.email === 'string' ? parsed.email : null;
      const password =
        typeof parsed?.password === 'string' ? parsed.password : null;
      if (!email || !password) return null;

      let storedAt = Number(parsed?.storedAt);
      // rows saved before the TTL existed have no stamp — start their week now
      // instead of treating them as already expired
      if (!parsed?.storedAt || !Number.isFinite(storedAt)) {
        storedAt = Date.now();
        localStorage.setItem(this.storageKey, JSON.stringify({ email, password, storedAt }));
      }
      if (Date.now() - storedAt > this.ttlMs) {
        this.clearStoredCredentials();
        return null;
      }

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

  /**
   * True when a Firebase user is still signed in but the stored credentials are
   * gone or past their week — i.e. the session should end now. Firebase's own
   * session never expires on its own, so this is what enforces the 1-week limit.
   */
  isSessionExpired(): boolean {
    return !!this.auth.currentUser && this.getStoredCredentials() == null;
  }

  logout() {
    this.clearStoredCredentials();
    return signOut(this.auth);
  }
}
