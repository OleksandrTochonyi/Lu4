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
import { Observable, firstValueFrom } from 'rxjs';
import { map, take } from 'rxjs/operators';

import { AuthService } from './auth.service';

/** one recorded quantity change on a stock row (newest first, last 5 kept) */
export interface StockHistoryEntry {
  ts: number;
  byEmail: string;
  byName: string;
  from: number;
  to: number;
}

export interface StockItem {
  id: string;
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

const HISTORY_LIMIT = 5;

function toInt(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
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

function normalizeStock(raw: any): StockItem {
  return {
    id: String(raw?.id ?? ''),
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

export interface NewStockItem {
  name: string;
  catalogId?: string | null;
  icon?: string | null;
  grade?: string | null;
  category?: string | null;
  qty: number;
}

@Injectable({ providedIn: 'root' })
export class WarehouseService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private col = collection(this.firestore, 'warehouse');

  /** live stream of the whole clan stock */
  readonly stock$: Observable<StockItem[]> = (
    collectionData(this.col, { idField: 'id' }) as Observable<any[]>
  ).pipe(map((list) => (list ?? []).map(normalizeStock)));

  private async actor(): Promise<{ email: string; name: string }> {
    const u = await firstValueFrom(this.auth.user$.pipe(take(1)));
    const email = String(u?.email ?? '').trim();
    const name =
      String(u?.displayName ?? '').trim() || (email ? email.split('@')[0] : 'неизвестно');
    return { email: email || 'неизвестно', name };
  }

  /** Add a new stock row. Returns its id. */
  async addItem(data: NewStockItem): Promise<string> {
    const name = (data.name ?? '').trim();
    if (!name) throw new Error('Название ресурса обязательно');

    const qty = toInt(data.qty);
    const actor = await this.actor();
    const ref = doc(this.col);
    await setDoc(ref, {
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
    return ref.id;
  }

  /** Set a new absolute quantity, recording who changed it and from/to. */
  async setQty(id: string, nextQty: number): Promise<void> {
    const ref = doc(this.firestore, `warehouse/${id}`);
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
  }

  async rename(id: string, name: string): Promise<void> {
    const clean = (name ?? '').trim();
    if (!clean) throw new Error('Название ресурса обязательно');
    await updateDoc(doc(this.firestore, `warehouse/${id}`), {
      name: clean,
      updatedAt: Date.now(),
    });
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `warehouse/${id}`));
  }
}
