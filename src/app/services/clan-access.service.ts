import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

import { AuthService } from './auth.service';
import { ConstPartyGroup, ConstPartyUser } from './const-party.service';

/**
 * Who is allowed to do what on the Clan page.
 *
 *  - admin (email contains "admin")            → full CRUD on packs + members + gear
 *  - party leader (isPL member, e-mail match)  → CRUD members + gear, but only in
 *                                                the pack(s) where they are the PL
 *  - a plain member (e-mail match, not PL)     → edit only their OWN level + gear
 *  - everyone else                             → read only
 */
@Injectable({ providedIn: 'root' })
export class ClanAccessService {
  private auth = inject(AuthService);

  readonly email = toSignal(
    this.auth.user$.pipe(map((u) => String(u?.email ?? '').trim().toLowerCase())),
    { initialValue: '' },
  );

  readonly isAdmin = toSignal(this.auth.isAdmin$, { initialValue: false });

  /** Is the current user the PL of this pack? */
  isPlOf(group: ConstPartyGroup | null | undefined): boolean {
    const email = this.email();
    if (!email || !group) return false;
    return (group.users ?? []).some(
      (u) => u.isPL && (u.email ?? '').trim().toLowerCase() === email,
    );
  }

  /** Can add / edit / delete members + change gear in this pack. */
  canManageMembers(group: ConstPartyGroup | null | undefined): boolean {
    return this.isAdmin() || this.isPlOf(group);
  }

  /** Only admins create / rename / delete packs. */
  canManagePacks(): boolean {
    return this.isAdmin();
  }

  /** Is this member the currently logged-in user (matched by e-mail)? */
  isSelf(user: ConstPartyUser | null | undefined): boolean {
    const email = this.email();
    if (!email || !user?.email) return false;
    return user.email.trim().toLowerCase() === email;
  }
}
