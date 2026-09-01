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
import { arrayRemove, arrayUnion } from 'firebase/firestore';
import { Observable, firstValueFrom } from 'rxjs';
import { map, take } from 'rxjs/operators';

export type ConstPartyRole = string;

export interface ConstPartyUser {
  /** stable id (uuid for new users, deterministic hash for legacy rows) */
  id: string;
  name: string;
  email: string;
  /** race id — see RACES in clan-mock-data */
  race: string;
  profession: string;
  level: number;
  /** combat role — see COMBAT_ROLES */
  role: ConstPartyRole;
  /** party leader of this pack */
  isPL: boolean;
  /** alt / secondary character */
  isTwink: boolean;
  /** slotId -> catalog item id */
  equipment: Record<string, string>;
}

export interface ConstPartyGroup {
  id: string;
  displayName: string;
  users: ConstPartyUser[];
}

type ConstPartyGroupDoc = Omit<ConstPartyGroup, 'id'>;

/** deterministic id for a legacy user row that has no `id` yet */
function stableId(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return 'u' + (h >>> 0).toString(36);
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return stableId(`${Date.now()}-${Math.random()}`);
}

/** Fill in every field + migrate the legacy `{ name, role: 'leader' | 'user' }` shape. */
export function normalizeUser(raw: any): ConstPartyUser {
  const name = String(raw?.name ?? '').trim();
  const legacyRole = String(raw?.role ?? '').toLowerCase();
  const legacyLeader = legacyRole === 'leader';
  const isLegacyRole = legacyRole === 'leader' || legacyRole === 'user' || legacyRole === '';

  const level = Number(raw?.level);
  const equipment =
    raw?.equipment && typeof raw.equipment === 'object' && !Array.isArray(raw.equipment)
      ? (raw.equipment as Record<string, string>)
      : {};

  return {
    id: String(raw?.id ?? '').trim() || stableId(name || JSON.stringify(raw ?? {})),
    name,
    email: String(raw?.email ?? '').trim(),
    race: String(raw?.race ?? '').trim(),
    profession: String(raw?.profession ?? '').trim(),
    level: Number.isFinite(level) && level > 0 ? Math.round(level) : 1,
    role: isLegacyRole ? '' : String(raw?.role ?? '').trim(),
    isPL: typeof raw?.isPL === 'boolean' ? raw.isPL : legacyLeader,
    isTwink: typeof raw?.isTwink === 'boolean' ? raw.isTwink : false,
    equipment,
  };
}

function serializeUser(u: ConstPartyUser): ConstPartyUser {
  return {
    id: u.id || newId(),
    name: (u.name ?? '').trim(),
    email: (u.email ?? '').trim(),
    race: (u.race ?? '').trim(),
    profession: (u.profession ?? '').trim(),
    level: Number.isFinite(Number(u.level)) && Number(u.level) > 0 ? Math.round(Number(u.level)) : 1,
    role: (u.role ?? '').trim(),
    isPL: !!u.isPL,
    isTwink: !!u.isTwink,
    equipment: u.equipment ?? {},
  };
}

function normalizeGroup(raw: any): ConstPartyGroup {
  return {
    id: String(raw?.id ?? ''),
    displayName: String(raw?.displayName ?? ''),
    users: Array.isArray(raw?.users) ? raw.users.map(normalizeUser) : [],
  };
}

@Injectable({
  providedIn: 'root',
})
export class ConstPartyService {
  private firestore = inject(Firestore);
  private groupsCollection = collection(this.firestore, 'const-party');

  getGroups(): Observable<ConstPartyGroup[]> {
    return (
      collectionData(this.groupsCollection, { idField: 'id' }) as Observable<any[]>
    ).pipe(map((groups) => (groups ?? []).map(normalizeGroup)));
  }

  getGroup(groupId: string): Observable<ConstPartyGroup | null> {
    const ref = doc(this.firestore, `const-party/${groupId}`);
    return (docData(ref, { idField: 'id' }) as Observable<any>).pipe(
      map((raw) => (raw ? normalizeGroup(raw) : null)),
    );
  }

  async createGroup(
    displayName: string,
    leader?: { name?: string; role?: string },
  ): Promise<string> {
    const name = (displayName ?? '').trim();
    if (!name) throw new Error('Название пака обязательно');

    const docRef = doc(this.groupsCollection);
    const leaderName = (leader?.name ?? '').trim();
    const users = leaderName
      ? [serializeUser(normalizeUser({ name: leaderName, isPL: true }))]
      : [];

    const payload: ConstPartyGroupDoc = { displayName: name, users };
    await setDoc(docRef, payload);
    return docRef.id;
  }

  async updateGroupDisplayName(groupId: string, displayName: string): Promise<void> {
    const id = (groupId ?? '').trim();
    const name = (displayName ?? '').trim();
    if (!id) throw new Error('Group id is required');
    if (!name) throw new Error('Название пака обязательно');

    await updateDoc(doc(this.firestore, `const-party/${id}`), { displayName: name });
  }

  async deleteGroup(groupId: string): Promise<void> {
    const id = (groupId ?? '').trim();
    if (!id) throw new Error('Group id is required');
    await deleteDoc(doc(this.firestore, `const-party/${id}`));
  }

  /* --------------------------------------------------- id-based user CRUD --- */

  private async readUsers(groupId: string): Promise<ConstPartyUser[]> {
    const ref = doc(this.firestore, `const-party/${groupId}`);
    const raw = (await firstValueFrom(docData(ref).pipe(take(1)))) as any;
    return Array.isArray(raw?.users) ? raw.users.map(normalizeUser) : [];
  }

  private async writeUsers(groupId: string, users: ConstPartyUser[]): Promise<void> {
    const ref = doc(this.firestore, `const-party/${groupId}`);
    await updateDoc(ref, { users: users.map(serializeUser) });
  }

  /** Add a member. Returns the new user's id. */
  async addUser(groupId: string, data: Partial<ConstPartyUser>): Promise<string> {
    const id = (groupId ?? '').trim();
    if (!id) throw new Error('Group id is required');
    if (!(data?.name ?? '').trim()) throw new Error('Имя персонажа обязательно');

    const users = await this.readUsers(id);
    const user = serializeUser(normalizeUser({ ...data, id: newId() }));

    let next = [...users, user];
    if (user.isPL) next = this.demoteOtherLeaders(next, user.id);

    await this.writeUsers(id, next);
    return user.id;
  }

  async updateUser(
    groupId: string,
    userId: string,
    patch: Partial<ConstPartyUser>,
  ): Promise<void> {
    const id = (groupId ?? '').trim();
    if (!id) throw new Error('Group id is required');

    const users = await this.readUsers(id);
    const idx = users.findIndex((u) => u.id === userId);
    if (idx < 0) throw new Error('Игрок не найден в паке');

    const merged = serializeUser({ ...users[idx], ...patch, id: users[idx].id });
    let next = [...users];
    next[idx] = merged;
    if (merged.isPL) next = this.demoteOtherLeaders(next, merged.id);

    await this.writeUsers(id, next);
  }

  async removeUser(groupId: string, userId: string): Promise<void> {
    const id = (groupId ?? '').trim();
    if (!id) throw new Error('Group id is required');

    const users = await this.readUsers(id);
    await this.writeUsers(id, users.filter((u) => u.id !== userId));
  }

  async setEquipment(
    groupId: string,
    userId: string,
    equipment: Record<string, string>,
  ): Promise<void> {
    await this.updateUser(groupId, userId, { equipment });
  }

  /** Only one PL per pack. */
  private demoteOtherLeaders(users: ConstPartyUser[], keepId: string): ConstPartyUser[] {
    return users.map((u) => (u.id !== keepId && u.isPL ? { ...u, isPL: false } : u));
  }

  /* ----------------------------------------------------- legacy name-based --- */
  /* Kept for the old /const-party screen; the new /users screen uses the id API. */

  async addUserToGroup(groupId: string, user: { name: string; role: string }): Promise<void> {
    const id = (groupId ?? '').trim();
    if (!id) throw new Error('Group id is required');
    await updateDoc(doc(this.firestore, `const-party/${id}`), {
      users: arrayUnion({ name: user.name.trim(), role: user.role.trim() }),
    });
  }

  async removeUserFromGroup(groupId: string, user: { name: string; role: string }): Promise<void> {
    const id = (groupId ?? '').trim();
    if (!id) throw new Error('Group id is required');
    await updateDoc(doc(this.firestore, `const-party/${id}`), {
      users: arrayRemove({ name: user.name, role: user.role }),
    });
  }

  async updateUserInGroup(
    groupId: string,
    prevUser: { name: string; role: string },
    nextUser: { name: string; role: string },
  ): Promise<void> {
    const id = (groupId ?? '').trim();
    if (!id) throw new Error('Group id is required');

    const groupRef = doc(this.firestore, `const-party/${id}`);
    const group = (await firstValueFrom(docData(groupRef).pipe(take(1)))) as any;
    const currentUsers: any[] = Array.isArray(group?.users) ? group.users : [];

    const idx = currentUsers.findIndex(
      (u) => u?.name === prevUser.name && u?.role === prevUser.role,
    );
    if (idx < 0) throw new Error('User not found in group');

    const updated = [...currentUsers];
    updated[idx] = { name: nextUser.name, role: nextUser.role };
    await updateDoc(groupRef, { users: updated });
  }
}
