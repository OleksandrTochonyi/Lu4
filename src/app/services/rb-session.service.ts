import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  DocumentData,
  doc,
  docData,
  addDoc,
  updateDoc,
  deleteDoc,
} from '@angular/fire/firestore';
import { Timestamp, DocumentReference } from 'firebase/firestore';
import { Observable, forkJoin, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

export interface RbSessionParticipant {
  group?: any | null;
  groupId?: string | null;
  users: string[];
}

export interface RbSessionLootItem {
  amount?: number | null;
  possibleLoot?: any | null;
}

export interface RbSessionRecord {
  id: string;
  killDate?: Date | null;
  rb?: any | null;
  participants: RbSessionParticipant[];
  loot: RbSessionLootItem[];
  raw: DocumentData;
}

export interface CreateRbSessionPayload {
  rbId: string;
  killDate?: Date | null;
  participants: Array<{
    groupId: string;
    users: string[];
  }>;
  loot: Array<{
    lootId: string;
    amount: number;
  }>;
}

@Injectable({ providedIn: 'root' })
export class RbSessionService {
  private readonly firestore = inject(Firestore);

  getSessions(): Observable<RbSessionRecord[]> {
    const sessionsCollection = collection(this.firestore, 'rb_sessions');

    return collectionData(sessionsCollection, { idField: 'id' }).pipe(
      switchMap((rows: DocumentData[]) => {
        if (!rows?.length) {
          return of<RbSessionRecord[]>([]);
        }

        const row$ = rows.map((row) => this.hydrateSession(row));
        return forkJoin(row$);
      })
    );
  }

  async createSession(payload: CreateRbSessionPayload): Promise<string> {
    const { rb, killDate, participants, loot } = this.buildSessionData(payload);

    const sessionsCollection = collection(this.firestore, 'rb_sessions');
    const data: Record<string, any> = {
      rb,
      killDate,
      participants,
      loot,
      createdAt: Timestamp.fromDate(new Date()),
    };

    const docRef = await addDoc(sessionsCollection, data);
    return docRef.id;
  }

  async updateSession(sessionId: string, payload: CreateRbSessionPayload): Promise<void> {
    const id = String(sessionId ?? '').trim();
    if (!id) {
      throw new Error('sessionId is required to update a session');
    }

    const { rb, killDate, participants, loot } = this.buildSessionData(payload);
    const ref = doc(this.firestore, 'rb_sessions', id);

    await updateDoc(ref, {
      rb,
      killDate,
      participants,
      loot,
      updatedAt: Timestamp.fromDate(new Date()),
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    const id = String(sessionId ?? '').trim();
    if (!id) {
      throw new Error('sessionId is required to delete a session');
    }

    const ref = doc(this.firestore, 'rb_sessions', id);
    await deleteDoc(ref);
  }

  private buildSessionData(payload: CreateRbSessionPayload): {
    rb: DocumentReference<DocumentData>;
    killDate: Timestamp;
    participants: Array<{ group: DocumentReference<DocumentData>; groupId: string; users: string[] }>;
    loot: Array<{ amount: number; possibleLoot: DocumentReference<DocumentData> }>;
  } {
    const rbId = String(payload?.rbId ?? '').trim();
    if (!rbId) {
      throw new Error('rbId is required to create or update a session');
    }

    const killDate = payload?.killDate instanceof Date ? payload.killDate : new Date();
    const rbRef = doc(this.firestore, 'rb-data', rbId);

    const participants = (payload?.participants ?? [])
      .map((participant) => {
        const groupId = String(participant?.groupId ?? '').trim();
        const users = (participant?.users ?? []).filter((user) => typeof user === 'string' && user.trim());

        if (!groupId || !users.length) {
          return null;
        }

        return {
          group: doc(this.firestore, 'const-party', groupId),
          groupId,
          users,
        };
      })
      .filter((entry): entry is { group: DocumentReference<DocumentData>; groupId: string; users: string[] } =>
        entry != null
      );

    const loot = (payload?.loot ?? [])
      .map((item) => {
        const lootId = String(item?.lootId ?? '').trim();
        const amount = Number(item?.amount ?? 0);
        if (!lootId || !Number.isFinite(amount) || amount <= 0) {
          return null;
        }

        return {
          amount,
          possibleLoot: doc(this.firestore, 'possibleLoot', lootId),
        };
      })
      .filter((entry): entry is { amount: number; possibleLoot: DocumentReference<DocumentData> } => entry != null);

    return {
      rb: rbRef,
      killDate: Timestamp.fromDate(killDate),
      participants,
      loot,
    };
  }

  private hydrateSession(row: DocumentData): Observable<RbSessionRecord> {
    const data = row as Record<string, any>;
    const rb$ = this.resolveRb(data['rb']);
    const loot$ = this.resolveLoot(data['loot']);
    const participants$ = this.resolveParticipants(data['participants']);

    return forkJoin([rb$, loot$, participants$]).pipe(
      map(([rbData, lootItems, participants]) => ({
        id: typeof data['id'] === 'string' ? (data['id'] as string) : '',
        killDate: this.toDate(data['killDate']),
        rb: rbData,
        participants,
        loot: lootItems,
        raw: row,
      }))
    );
  }

  private resolveReference(ref: any): Observable<any | null> {
    if (!this.isDocumentReference(ref)) {
      return of(null);
    }

    const documentRef = ref as DocumentReference<DocumentData>;
    return docData(documentRef, { idField: 'id' }).pipe(take(1));
  }

  private resolveLoot(rawLoot: any): Observable<RbSessionLootItem[]> {
    if (!rawLoot) {
      return of([]);
    }

    if (this.isDocumentReference(rawLoot)) {
      return docData(rawLoot, { idField: 'id' }).pipe(
        take(1),
        switchMap((doc) => {
          if (!doc) return of([]);

          const payload = doc as Record<string, any>;
          if (Array.isArray(payload['items'])) {
            return this.resolveLoot(payload['items']);
          }
          if (Array.isArray(payload['loot'])) {
            return this.resolveLoot(payload['loot']);
          }

          return this.resolveLoot([payload]);
        })
      );
    }

    if (Array.isArray(rawLoot)) {
      const lootObservables = rawLoot.map((entry: any) => {
        if (entry == null) {
          return of<RbSessionLootItem>({ amount: 0, possibleLoot: null });
        }

        if (this.isDocumentReference(entry)) {
          return docData(entry, { idField: 'id' }).pipe(
            take(1),
            switchMap((doc) => {
              if (!doc) return of<RbSessionLootItem>({ amount: null, possibleLoot: null });

              const record = doc as Record<string, any>;
              if (Array.isArray(record['items'])) {
                return this.resolveLoot(record['items']).pipe(
                  map((items) => items[0] ?? { amount: 1, possibleLoot: null })
                );
              }

              if (Array.isArray(record['loot'])) {
                return this.resolveLoot(record['loot']).pipe(
                  map((items) => items[0] ?? { amount: 1, possibleLoot: null })
                );
              }

              const amountSource = record['amount'] ?? record['qty'] ?? record['quantity'];
              const amount = amountSource != null ? this.normalizeAmount(amountSource) : null;
              return of<RbSessionLootItem>({ amount, possibleLoot: record });
            })
          );
        }

        const payload = entry as Record<string, any>;

        const amountSource = payload['amount'] ?? payload['qty'] ?? payload['quantity'];
        const amount = amountSource != null ? this.normalizeAmount(amountSource) : null;

        const possibleLootRef = payload['possibleLoot'] ?? payload['loot'] ?? payload['item'];

        if (this.isDocumentReference(possibleLootRef)) {
          return docData(possibleLootRef, { idField: 'id' }).pipe(
            take(1),
            map((data) => ({ amount, possibleLoot: data ?? null }))
          );
        }

        if (Array.isArray(possibleLootRef)) {
          return this.resolveLoot(possibleLootRef).pipe(
            map((items) => ({ amount, possibleLoot: items[0]?.possibleLoot ?? null }))
          );
        }

        if (typeof possibleLootRef === 'object' && possibleLootRef != null) {
          return of({ amount, possibleLoot: possibleLootRef });
        }

        if (typeof possibleLootRef === 'string') {
          return of({
            amount,
            possibleLoot: { id: possibleLootRef, name: possibleLootRef },
          });
        }

        return of({ amount, possibleLoot: null });
      });

      if (!lootObservables.length) {
        return of([]);
      }

      return forkJoin(lootObservables);
    }

    if (typeof rawLoot === 'object') {
      return this.resolveLoot([rawLoot]);
    }

    return of([]);
  }

  private resolveParticipants(raw: any): Observable<RbSessionParticipant[]> {
    if (!raw) return of([]);

    const list = Array.isArray(raw) ? raw : [raw];
    const participantStreams = list.map((entry: any) => {
      if (!entry) {
        return of<RbSessionParticipant>({ group: null, groupId: null, users: [] });
      }

      const record = entry as Record<string, any>;
      const groupRef = record['group'] ?? record['groupRef'];
      const presetUsers = this.extractUsers(record['users']);

      if (this.isDocumentReference(groupRef)) {
        return docData(groupRef, { idField: 'id' }).pipe(
          take(1),
          map((groupData) => {
            const groupPayload = groupData ? (groupData as Record<string, any>) : null;
            const groupUsers = presetUsers.length
              ? presetUsers
              : this.extractUsers(
                  groupPayload?.['users'] ??
                    groupPayload?.['members'] ??
                    groupPayload?.['names']
                );

            const groupId =
              groupPayload?.['id'] ??
              this.extractIdFromReference(groupRef);

            return {
              group: groupPayload,
              groupId,
              users: groupUsers,
            } satisfies RbSessionParticipant;
          })
        );
      }

      const groupPayload =
        typeof groupRef === 'object' && groupRef != null ? (groupRef as Record<string, any>) : null;
      const groupId = typeof record['groupId'] === 'string' ? record['groupId'] : groupPayload?.['id'] ?? null;

      return of<RbSessionParticipant>({
        group: groupPayload,
        groupId,
        users: presetUsers,
      });
    });

    if (!participantStreams.length) {
      return of([]);
    }

    return forkJoin(participantStreams).pipe(
      map((participants) =>
        participants.map((item) => ({
          ...item,
          users: item.users.filter((user) => typeof user === 'string' && user.trim().length > 0),
        }))
      )
    );
  }

  private toDate(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (value instanceof Timestamp) return value.toDate();
    if (typeof value?.toDate === 'function') return value.toDate();

    if (typeof value === 'string') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (typeof value?.seconds === 'number') {
      return new Date(value.seconds * 1000);
    }

    return null;
  }

  private resolveRb(ref: any): Observable<any | null> {
    if (!this.isDocumentReference(ref)) {
      return of(null);
    }

    const documentRef = ref as DocumentReference<DocumentData>;
    return docData(documentRef, { idField: 'id' }).pipe(
      take(1),
      switchMap((data) => {
        if (!data) return of(null);

        const record = { ...(data as Record<string, any>) };

        if (Array.isArray(record['loot']) && record['loot'].length) {
          return this.resolveLoot(record['loot']).pipe(
            map((lootItems) => ({
              ...record,
              loot: lootItems
                .map((item) => this.extractLootObject(item))
                .filter((entry): entry is Record<string, any> => entry != null),
            }))
          );
        }

        return of(record);
      })
    );
  }

  private isDocumentReference(value: any): value is DocumentReference<DocumentData> {
    return (
      value != null &&
      typeof value === 'object' &&
      typeof (value as DocumentReference<DocumentData>).path === 'string' &&
      typeof (value as DocumentReference<DocumentData>).firestore === 'object'
    );
  }

  private normalizeAmount(value: any, fallback = 1): number {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
    return fallback;
  }

  private extractLootObject(item: RbSessionLootItem | null): Record<string, any> | null {
    if (!item) return null;

    const candidate = item.possibleLoot;
    if (candidate && typeof candidate === 'object') {
      return candidate as Record<string, any>;
    }

    return null;
  }

  private extractUsers(value: any): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value
        .map((entry) => (typeof entry === 'string' ? entry : null))
        .filter((entry): entry is string => entry != null);
    }

    if (typeof value === 'string') {
      return [value];
    }

    return [];
  }

  private extractIdFromReference(ref: DocumentReference<DocumentData>): string | null {
    const path = ref?.path ?? '';
    if (!path) return null;
    const segments = path.split('/');
    return segments.length ? segments[segments.length - 1] : null;
  }
}
