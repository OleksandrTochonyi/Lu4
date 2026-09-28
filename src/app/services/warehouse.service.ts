import { Injectable, inject } from '@angular/core';
import {
  CollectionReference,
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  docData,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, firstValueFrom, of } from 'rxjs';
import { catchError, map, take } from 'rxjs/operators';

import { AuthService } from './auth.service';
import { ActivityLogService } from './activity-log.service';

/**
 * Склады (ported from Lu4 Black):
 *
 * - **personal** — every user gets exactly one, empty by default (deterministic
 *   doc id `p_<email>`, so "at most one" is structural).
 * - **shared** — any user can create one and invite other listed users via
 *   `members`; only its creator may rename / change members / delete it.
 * - **clan** — the original clan stock. It stays in its legacy flat `warehouse`
 *   collection untouched (no migration); it's a virtual warehouse with the fixed
 *   id {@link CLAN_WAREHOUSE_ID}, shown only to admins with the "Склад клана"
 *   switch on (`SiteUser.clanWarehouse`).
 *
 * Personal/shared stock rows live in the flat `warehouseStock` collection keyed
 * by `warehouseId` (not an embedded array), so two members editing a shared
 * warehouse at once never clobber each other.
 */

/** one recorded quantity change on a stock row (newest first) */
export interface StockHistoryEntry {
  ts: number;
  byEmail: string;
  byName: string;
  from: number;
  to: number;
}

export interface StockItem {
  id: string;
  /** which warehouse the row belongs to ({@link CLAN_WAREHOUSE_ID} for the clan stock) */
  warehouseId: string;
  name: string;
  /** data.json catalog id when the row was picked from the catalogue */
  catalogId: string | null;
  icon: string | null;
  grade: string | null;
  category: string | null;
  qty: number;
  history: StockHistoryEntry[];
  updatedAt: number;
}

export interface NewStockItem {
  name: string;
  catalogId?: string | null;
  icon?: string | null;
  grade?: string | null;
  category?: string | null;
  qty: number;
}

export type WarehouseType = 'clan' | 'personal' | 'shared';

export interface Warehouse {
  id: string;
  type: WarehouseType;
  name: string;
  ownerEmail: string;
  /** lowercased emails incl. the owner — who can see / edit it (empty for the clan one) */
  members: string[];
  createdAt: number;
}

export const CLAN_WAREHOUSE_ID = 'clan';

export const CLAN_WAREHOUSE: Warehouse = {
  id: CLAN_WAREHOUSE_ID,
  type: 'clan',
  name: 'Склад клана',
  ownerEmail: '',
  members: [],
  createdAt: 0,
};

const HISTORY_LIMIT = 5;

function toInt(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normEmail(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

function normalizeHistory(raw: unknown): StockHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e: any) => ({
      ts: Number(e?.ts) || 0,
      byEmail: String(e?.byEmail ?? ''),
      byName: String(e?.byName ?? '') || String(e?.byEmail ?? '') || 'неизвестно',
      from: Math.round(Number(e?.from) || 0),
      to: Math.round(Number(e?.to) || 0),
    }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, HISTORY_LIMIT);
}

function normalizeStock(raw: any, warehouseId?: string): StockItem {
  return {
    id: String(raw?.id ?? ''),
    warehouseId: warehouseId ?? String(raw?.warehouseId ?? ''),
    name: String(raw?.name ?? '').trim(),
    catalogId: raw?.catalogId ? String(raw.catalogId) : null,
    icon: raw?.icon ? String(raw.icon) : null,
    grade: raw?.grade ? String(raw.grade) : null,
    category: raw?.category ? String(raw.category) : null,
    qty: toInt(raw?.qty),
    history: normalizeHistory(raw?.history),
    updatedAt: Number(raw?.updatedAt) || 0,
  };
}

function normalizeWarehouse(raw: any): Warehouse {
  return {
    id: String(raw?.id ?? ''),
    type: raw?.type === 'shared' ? 'shared' : 'personal',
    name: String(raw?.name ?? '').trim(),
    ownerEmail: normEmail(raw?.ownerEmail),
    members: Array.isArray(raw?.members) ? raw.members.map(normEmail).filter(Boolean) : [],
    createdAt: Number(raw?.createdAt) || 0,
  };
}

function uniqueMembers(owner: string, emails: string[]): string[] {
  return Array.from(new Set([normEmail(owner), ...emails.map(normEmail)])).filter(Boolean);
}

@Injectable({ providedIn: 'root' })
export class WarehouseService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private activityLog = inject(ActivityLogService);
  /** legacy clan stock — flat, no warehouseId */
  private clanCol = collection(this.firestore, 'warehouse');
  private whCol = collection(this.firestore, 'warehouses');
  private stockCol = collection(this.firestore, 'warehouseStock');

  /** every personal + shared warehouse the email belongs to (the clan one is added by the page) */
  myWarehouses$(email: string): Observable<Warehouse[]> {
    const e = normEmail(email);
    if (!e) return of([] as Warehouse[]);
    return (
      collectionData(query(this.whCol, where('members', 'array-contains', e)), {
        idField: 'id',
      }) as Observable<any[]>
    ).pipe(
      map((list) => (list ?? []).map(normalizeWarehouse)),
      catchError(() => of([] as Warehouse[])),
    );
  }

  /** live stock of one warehouse */
  stockOf$(warehouseId: string): Observable<StockItem[]> {
    if (!warehouseId) return of([] as StockItem[]);
    if (warehouseId === CLAN_WAREHOUSE_ID) {
      return (collectionData(this.clanCol, { idField: 'id' }) as Observable<any[]>).pipe(
        map((list) => (list ?? []).map((r) => normalizeStock(r, CLAN_WAREHOUSE_ID))),
        catchError(() => of([] as StockItem[])),
      );
    }
    return (
      collectionData(query(this.stockCol, where('warehouseId', '==', warehouseId)), {
        idField: 'id',
      }) as Observable<any[]>
    ).pipe(
      map((list) => (list ?? []).map((r) => normalizeStock(r))),
      catchError(() => of([] as StockItem[])),
    );
  }

  /* ------------------------------------------------------------ warehouses */

  /** makes sure `email` has its one personal warehouse; returns its id */
  async ensurePersonal(email: string): Promise<string> {
    const e = normEmail(email);
    const id = 'p_' + e;
    const ref = doc(this.firestore, 'warehouses', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        type: 'personal',
        name: 'Мой склад',
        ownerEmail: e,
        members: [e],
        createdAt: Date.now(),
      });
    }
    return id;
  }

  async createShared(name: string, ownerEmail: string, memberEmails: string[]): Promise<string> {
    const clean = (name || '').trim() || 'Общий склад';
    const owner = normEmail(ownerEmail);
    const ref = await addDoc(this.whCol, {
      type: 'shared',
      name: clean,
      ownerEmail: owner,
      members: uniqueMembers(owner, memberEmails),
      createdAt: Date.now(),
    });
    this.activityLog.log('Создал склад', clean);
    return ref.id;
  }

  async renameShared(id: string, name: string): Promise<void> {
    const clean = (name || '').trim();
    if (!clean) throw new Error('Название обязательно');
    await updateDoc(doc(this.firestore, 'warehouses', id), { name: clean });
    this.activityLog.log('Переименовал склад', clean);
  }

  async setMembers(w: Warehouse, memberEmails: string[]): Promise<void> {
    const members = uniqueMembers(w.ownerEmail, memberEmails);
    await updateDoc(doc(this.firestore, 'warehouses', w.id), { members });
    this.activityLog.log('Изменил участников склада', `${w.name}: ${members.length}`);
  }

  /** deletes a shared warehouse together with all of its stock rows */
  async deleteShared(w: Warehouse): Promise<void> {
    if (w.type !== 'shared') throw new Error('Этот склад удалить нельзя');
    const rows = await getDocs(query(this.stockCol, where('warehouseId', '==', w.id)));
    const batch = writeBatch(this.firestore);
    rows.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(this.firestore, 'warehouses', w.id));
    await batch.commit();
    this.activityLog.log('Удалил склад', w.name);
  }

  /* ----------------------------------------------------------------- stock */

  private stockColFor(warehouseId: string): CollectionReference {
    return warehouseId === CLAN_WAREHOUSE_ID ? this.clanCol : this.stockCol;
  }
  private stockDoc(warehouseId: string, id: string) {
    return doc(this.stockColFor(warehouseId), id);
  }

  private async actor(): Promise<{ email: string; name: string }> {
    const u = await firstValueFrom(this.auth.user$.pipe(take(1)));
    const email = String(u?.email ?? '').trim();
    const name =
      String(u?.displayName ?? '').trim() || (email ? email.split('@')[0] : 'неизвестно');
    return { email: email || 'неизвестно', name };
  }

  /** "Склад клана: Iron Ore" — the log line says which warehouse it was */
  private label(w: Warehouse, what: string): string {
    return `${w.name}: ${what}`;
  }

  /** Add a new stock row to a warehouse. Returns its id. */
  async addItem(w: Warehouse, data: NewStockItem): Promise<string> {
    const name = (data.name ?? '').trim();
    if (!name) throw new Error('Название ресурса обязательно');

    const qty = toInt(data.qty);
    const actor = await this.actor();
    const ref = doc(this.stockColFor(w.id));
    await setDoc(ref, {
      // the clan stock is its own collection and never carried a warehouseId
      ...(w.id === CLAN_WAREHOUSE_ID ? {} : { warehouseId: w.id }),
      name,
      catalogId: data.catalogId ?? null,
      icon: data.icon ?? null,
      grade: data.grade ?? null,
      category: data.category ?? null,
      qty,
      history:
        qty > 0
          ? [{ ts: Date.now(), byEmail: actor.email, byName: actor.name, from: 0, to: qty }]
          : [],
      updatedAt: Date.now(),
    });
    this.activityLog.log('Добавил ресурс на склад', this.label(w, name));
    return ref.id;
  }

  /** Set a new absolute quantity, recording who changed it and from/to. */
  async setQty(w: Warehouse, id: string, nextQty: number): Promise<void> {
    const ref = this.stockDoc(w.id, id);
    const raw = (await firstValueFrom(docData(ref).pipe(take(1)))) as any;
    if (!raw) throw new Error('Ресурс не найден');

    const from = toInt(raw.qty);
    const to = toInt(nextQty);
    if (from === to) return;

    const actor = await this.actor();
    const entry: StockHistoryEntry = {
      ts: Date.now(),
      byEmail: actor.email,
      byName: actor.name,
      from,
      to,
    };
    const history = [entry, ...normalizeHistory(raw.history)].slice(0, HISTORY_LIMIT);
    await updateDoc(ref, { qty: to, history, updatedAt: Date.now() });
    this.activityLog.log('Изменил склад', this.label(w, `${raw.name}: ${from} → ${to}`));
  }

  async rename(w: Warehouse, id: string, name: string): Promise<void> {
    const clean = (name ?? '').trim();
    if (!clean) throw new Error('Название ресурса обязательно');
    await updateDoc(this.stockDoc(w.id, id), { name: clean, updatedAt: Date.now() });
    this.activityLog.log('Переименовал ресурс на складе', this.label(w, clean));
  }

  async remove(w: Warehouse, item: StockItem): Promise<void> {
    await deleteDoc(this.stockDoc(w.id, item.id));
    this.activityLog.log('Удалил ресурс со склада', this.label(w, item.name));
  }
}
