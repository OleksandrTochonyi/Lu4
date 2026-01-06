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
import { take } from 'rxjs/operators';

export type ConstPartyRole = string;

export interface ConstPartyUser {
  name: string;
  role: ConstPartyRole;
}

export interface ConstPartyGroup {
  id: string;
  displayName: string;
  users: ConstPartyUser[];
}

type ConstPartyGroupDoc = Omit<ConstPartyGroup, 'id'>;

@Injectable({
  providedIn: 'root',
})
export class ConstPartyService {
  private firestore = inject(Firestore);
  private groupsCollection = collection(this.firestore, 'const-party');

  getGroups(): Observable<ConstPartyGroup[]> {
    return collectionData(this.groupsCollection, { idField: 'id' }) as Observable<ConstPartyGroup[]>;
  }

  async createGroup(displayName: string, leader: ConstPartyUser): Promise<string> {
    const name = (displayName ?? '').trim();
    const leaderName = (leader?.name ?? '').trim();

    if (!name) throw new Error('Group displayName is required');
    if (!leaderName) throw new Error('Leader name is required');

    const docRef = doc(this.groupsCollection);
    const payload: ConstPartyGroupDoc = {
      displayName: name,
      users: [{ name: leaderName, role: 'leader' }],
    };

    await setDoc(docRef, payload);
    return docRef.id;
  }

  async updateGroupDisplayName(groupId: string, displayName: string): Promise<void> {
    const id = (groupId ?? '').trim();
    const name = (displayName ?? '').trim();

    if (!id) throw new Error('Group id is required');
    if (!name) throw new Error('Group displayName is required');

    const groupRef = doc(this.firestore, `const-party/${id}`);
    await updateDoc(groupRef, { displayName: name });
  }

  async deleteGroup(groupId: string): Promise<void> {
    const id = (groupId ?? '').trim();
    if (!id) throw new Error('Group id is required');

    const groupRef = doc(this.firestore, `const-party/${id}`);
    await deleteDoc(groupRef);
  }

  async addUserToGroup(groupId: string, user: ConstPartyUser): Promise<void> {
    const id = (groupId ?? '').trim();
    const userName = (user?.name ?? '').trim();
    const userRole = (user?.role ?? '').trim();

    if (!id) throw new Error('Group id is required');
    if (!userName) throw new Error('User name is required');
    if (!userRole) throw new Error('User role is required');

    const groupRef = doc(this.firestore, `const-party/${id}`);
    await updateDoc(groupRef, {
      users: arrayUnion({ name: userName, role: userRole }),
    });
  }

  async removeUserFromGroup(groupId: string, user: ConstPartyUser): Promise<void> {
    const id = (groupId ?? '').trim();
    const userName = (user?.name ?? '').trim();
    const userRole = (user?.role ?? '').trim();

    if (!id) throw new Error('Group id is required');
    if (!userName) throw new Error('User name is required');
    if (!userRole) throw new Error('User role is required');

    const groupRef = doc(this.firestore, `const-party/${id}`);
    await updateDoc(groupRef, {
      users: arrayRemove({ name: userName, role: userRole }),
    });
  }

  async updateUserInGroup(
    groupId: string,
    prevUser: ConstPartyUser,
    nextUser: ConstPartyUser
  ): Promise<void> {
    const id = (groupId ?? '').trim();
    if (!id) throw new Error('Group id is required');

    const prevName = (prevUser?.name ?? '').trim();
    const prevRole = (prevUser?.role ?? '').trim();
    const nextName = (nextUser?.name ?? '').trim();
    const nextRole = (nextUser?.role ?? '').trim();

    if (!prevName || !prevRole) throw new Error('Previous user is invalid');
    if (!nextName || !nextRole) throw new Error('Next user is invalid');

    const groupRef = doc(this.firestore, `const-party/${id}`);
    const group = (await firstValueFrom(docData(groupRef).pipe(take(1)))) as any;
    const currentUsers: ConstPartyUser[] = Array.isArray(group?.users) ? group.users : [];

    const idx = currentUsers.findIndex((u) => u?.name === prevName && u?.role === prevRole);
    if (idx < 0) throw new Error('User not found in group');

    const updatedUsers = [...currentUsers];
    updatedUsers[idx] = { name: nextName, role: nextRole };

    await updateDoc(groupRef, { users: updatedUsers });
  }
}
