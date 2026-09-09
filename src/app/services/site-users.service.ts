import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  docData,
  setDoc,
  updateDoc,
} from '@angular/fire/firestore';
import { Observable, combineLatest, of } from 'rxjs';
import { map, shareReplay, switchMap } from 'rxjs/operators';

import { AuthService } from './auth.service';

/**
 * `admin` = full access. `kp` and `merc` (Наёмник) are both plain members with
 * the exact same (non-admin) rights — they only differ as a label. Legacy rows
 * stored `role: 'user'`; those normalize to `kp`.
 */
export type SiteRole = 'admin' | 'kp' | 'merc';

function normalizeRole(v: unknown): SiteRole {
  const r = String(v ?? '').trim().toLowerCase();
  if (r === 'admin') return 'admin';
  if (r === 'merc' || r === 'mercenary') return 'merc';
  return 'kp'; // 'kp', legacy 'user', empty, anything unrecognised
}

/** admins first, then КП, then наёмники — for the list sort */
function roleRank(role: SiteRole): number {
  return role === 'admin' ? 0 : role === 'kp' ? 1 : 2;
}

export interface SiteUser {
  /** lowercased email — also the Firestore doc id */
  email: string;
  role: SiteRole;
  blocked: boolean;
  name: string;
  note: string;
  createdAt: number;
  createdBy: string;
  /** last time this account was seen logging in / using the app */
  lastSeenAt: number;
}

function normEmail(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

/**
 * Turn a stored email into something human for a "who did it" caption in a
 * change history: their name from the `site-users` list, or the raw email when
 * we have no name on file. Pass the map from `SiteUsersService.namesByEmail$`.
 */
export function actorLabel(
  email: string | null | undefined,
  namesByEmail?: Map<string, string> | null,
): string {
  const raw = String(email ?? '').trim();
  if (!raw) return 'неизвестно';
  return namesByEmail?.get(raw.toLowerCase()) || raw;
}

function normalize(raw: any): SiteUser {
  return {
    email: normEmail(raw?.email ?? raw?.id),
    role: normalizeRole(raw?.role),
    blocked: !!raw?.blocked,
    name: String(raw?.name ?? ''),
    note: String(raw?.note ?? ''),
    createdAt: Number(raw?.createdAt) || 0,
    createdBy: String(raw?.createdBy ?? ''),
    lastSeenAt: Number(raw?.lastSeenAt) || 0,
  };
}

/**
 * The site's access list. Every real login is auto-registered here as `user`;
 * an admin promotes / blocks / removes rows from the `/admin/users` page.
 *
 * There's no backend, so this can't touch Firebase Auth itself — "block" is a
 * flag the app enforces (guard + shell both sign a blocked user straight out),
 * "delete" just drops the authorization row (a still-valid Auth account would
 * re-register as a plain `user` on its next login — use "block" to truly bar).
 *
 * Bootstrap/recovery: while NO active admin row exists, any logged-in user is
 * treated as admin (and the first one to load gets seeded as `admin`), so the
 * list can never lock everyone out.
 */
@Injectable({ providedIn: 'root' })
export class SiteUsersService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private col = collection(this.firestore, 'site-users');

  readonly siteUsers$: Observable<SiteUser[]> = (
    collectionData(this.col, { idField: 'id' }) as Observable<any[]>
  ).pipe(
    map((list) =>
      (list ?? [])
        .map(normalize)
        .sort(
          (a, b) =>
            roleRank(a.role) - roleRank(b.role) || a.email.localeCompare(b.email),
        ),
    ),
  );

  /**
   * email -> display name, for every listed user that actually has a name set.
   * Used to show a real name instead of an email in change-history captions
   * (warehouse stock history, raid sales, the activity log, …). Falls back to
   * the email itself via {@link actorLabel} when someone has no name on file.
   */
  readonly namesByEmail$: Observable<Map<string, string>> = this.siteUsers$.pipe(
    map((list) => {
      const m = new Map<string, string>();
      for (const u of list) {
        const name = (u.name ?? '').trim();
        if (name) m.set(u.email, name);
      }
      return m;
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  private readonly myEmail$ = this.auth.user$.pipe(map((u) => normEmail(u?.email)));

  /** the current user's own access row (undefined until it loads / if none) */
  readonly myRow$: Observable<SiteUser | null> = this.myEmail$.pipe(
    switchMap((email) =>
      email
        ? (docData(doc(this.firestore, `site-users/${email}`)) as Observable<any>).pipe(
            map((raw) => (raw ? normalize({ ...raw, email }) : null)),
          )
        : of(null),
    ),
  );

  readonly isAdmin$: Observable<boolean> = combineLatest([
    this.myRow$,
    this.siteUsers$,
    this.auth.user$,
  ]).pipe(
    map(([row, list, user]) => {
      if (!user) return false;
      if (row?.blocked) return false;
      if (row?.role === 'admin') return true;
      if (list.length === 0) return true; // pure bootstrap: collection is empty
      // recovery: a listed, non-blocked user regains admin when no admin is left
      const hasActiveAdmin = list.some((u) => u.role === 'admin' && !u.blocked);
      return !!row && !hasActiveAdmin;
    }),
  );

  readonly isBlocked$: Observable<boolean> = this.myRow$.pipe(
    map((row) => row?.blocked === true),
  );

  /**
   * Why the current user can't use the site (null = they can). This is a STRICT
   * allowlist: you must have a `site-users` row, and it must not be `blocked`.
   * (`null` while logged out too — that's `authGuard`'s job, not this.)
   */
  readonly deniedReason$: Observable<'blocked' | 'not-listed' | null> = combineLatest([
    this.auth.user$,
    this.myRow$,
    this.siteUsers$,
  ]).pipe(
    map(([user, row, list]) => {
      if (!user) return null;
      if (row?.blocked) return 'blocked';
      if (!row && list.length > 0) return 'not-listed';
      return null;
    }),
  );

  private seeding = false;
  private lastSeenWrittenAt = 0;

  constructor() {
    combineLatest([this.auth.user$, this.siteUsers$]).subscribe(([user, list]) => {
      const email = normEmail(user?.email);
      if (!email || this.seeding) return;

      // ONLY auto-create when the collection is completely empty — seeds the very
      // first user as admin so a fresh deploy can't lock everyone out. Otherwise
      // it's a strict allowlist: an email that isn't already a row gets nothing
      // (the guard + shell sign it straight out).
      if (list.length === 0) {
        this.seeding = true;
        void setDoc(doc(this.firestore, `site-users/${email}`), {
          email,
          role: 'admin',
          blocked: false,
          name: String(user?.displayName ?? ''),
          note: '',
          createdAt: Date.now(),
          createdBy: 'auto',
          lastSeenAt: Date.now(),
        })
          .catch(() => null)
          .finally(() => (this.seeding = false));
        return;
      }

      const mine = list.find((u) => u.email === email);
      // touch lastSeenAt at most once an hour to avoid write spam
      if (mine && !mine.blocked && Date.now() - this.lastSeenWrittenAt > 60 * 60 * 1000) {
        this.lastSeenWrittenAt = Date.now();
        void updateDoc(doc(this.firestore, `site-users/${email}`), {
          lastSeenAt: Date.now(),
        }).catch(() => null);
      }
    });
  }

  /* -------------------------------------------------- admin actions -------- */

  async addUser(
    email: string,
    role: SiteRole,
    name: string,
    note: string,
    actorEmail: string,
  ): Promise<void> {
    const id = normEmail(email);
    if (!id) throw new Error('Укажите email');
    await setDoc(
      doc(this.firestore, `site-users/${id}`),
      {
        email: id,
        role,
        blocked: false,
        name: name.trim(),
        note: note.trim(),
        createdAt: Date.now(),
        createdBy: actorEmail || 'admin',
        lastSeenAt: 0,
      },
      { merge: true },
    );
  }

  async setBlocked(email: string, blocked: boolean): Promise<void> {
    await updateDoc(doc(this.firestore, `site-users/${normEmail(email)}`), { blocked });
  }

  /** stamp lastSeenAt now — called on an explicit login (the constructor's hourly
   *  throttle covers silent auto-logins) */
  async markSeen(email: string): Promise<void> {
    const id = normEmail(email);
    if (!id) return;
    this.lastSeenWrittenAt = Date.now();
    await updateDoc(doc(this.firestore, `site-users/${id}`), { lastSeenAt: Date.now() }).catch(
      () => null,
    );
  }

  /**
   * Save an edit to one row — email / role / name / note. If the email changed
   * the row is a doc-id "rename" (write the new id, delete the old one); the
   * caller passes the whole `SiteUser` so blocked/createdAt/etc. carry over.
   */
  async saveUser(oldEmail: string, next: SiteUser): Promise<void> {
    const oldId = normEmail(oldEmail);
    const newId = normEmail(next.email);
    if (!newId) throw new Error('Укажите email');

    if (newId === oldId) {
      await updateDoc(doc(this.firestore, `site-users/${oldId}`), {
        role: next.role,
        name: next.name.trim(),
        note: next.note.trim(),
      });
      return;
    }

    await setDoc(doc(this.firestore, `site-users/${newId}`), {
      email: newId,
      role: next.role,
      blocked: !!next.blocked,
      name: next.name.trim(),
      note: next.note.trim(),
      createdAt: next.createdAt || Date.now(),
      createdBy: next.createdBy || 'admin',
      lastSeenAt: 0,
    });
    await deleteDoc(doc(this.firestore, `site-users/${oldId}`));
  }

  async remove(email: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `site-users/${normEmail(email)}`));
  }
}
