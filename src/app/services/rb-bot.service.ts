import { Injectable, inject } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDoc,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, catchError, map, of, shareReplay, switchMap } from 'rxjs';

import { ActivityLogService } from './activity-log.service';

/** collection the bot writes to (see docs/bot-api.md) */
export const BOT_COLLECTION = 'rb-bot-suggestions';
/** screenshots live apart (same doc id), so the list never downloads pictures */
export const BOT_PHOTO_COLLECTION = 'rb-bot-photos';

export type BotStatus = 'new' | 'applied' | 'rejected';
/** what the bot saw: the RB killed, or the RB standing alive (spawned) */
export type BotEvent = 'killed' | 'alive';

/** live status the bot keeps upserting (one doc per bot, id = botId) */
export const BOT_STATUS_COLLECTION = 'rb-bot-status';

/** one RB the bot plans to visit next */
export interface BotQueueItem {
  bossName: string;
  bossId: string | null;
  /** when it expects to be there / the resp starts (ms, 0 = unknown) */
  at: number;
  note: string;
}

/** «работает ли бот и что делает» */
export interface BotLiveStatus {
  /** document id — the bot instance */
  id: string;
  /** game character / account the bot plays */
  account: string;
  /** free state word: idle | moving | waiting | fighting | looting | stopped | error | … */
  state: string;
  currentBoss: string;
  currentBossId: string | null;
  location: string;
  message: string;
  queue: BotQueueItem[];
  /** last heartbeat (ms) */
  updatedAt: number;
  /** how often the bot promises to report (s) — staleness is judged against it */
  intervalSec: number;
  version: string;
}

/** «бот видел, что РБ убит / жив в …» — waiting to be accepted or removed */
export interface BotSuggestion {
  id: string;
  /** killed (→ can go to the resp) or alive (info: it's standing) */
  event: BotEvent;
  /** as the bot sent it */
  bossName: string;
  /** optional — the db.json id, when the bot knows it */
  bossId: string | null;
  /** time of the event: kill time for «killed», when it was seen for «alive» */
  at: number;
  /** = at for «killed», 0 for «alive» */
  killedAt: number;
  /** when the bot sent it (falls back to killedAt) */
  sentAt: number;
  hasPhoto: boolean;
  note: string;
  source: string;
  status: BotStatus;
  handledBy: string;
  handledAt: number | null;
}

/** Firestore Timestamp | ISO string | epoch ms/sec → epoch ms (0 = unknown) */
function toMs(v: any): number {
  if (v == null) return 0;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n) && v.trim() !== '') return n < 1e12 ? n * 1000 : n;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  return 0;
}

function normalizeStatus(raw: any): BotLiveStatus {
  const queue = Array.isArray(raw?.queue) ? raw.queue : [];
  return {
    id: String(raw?.id ?? ''),
    account: String(raw?.account ?? raw?.id ?? ''),
    state: String(raw?.state ?? '').trim().toLowerCase(),
    currentBoss: String(raw?.currentBoss ?? '').trim(),
    currentBossId: raw?.currentBossId != null && String(raw.currentBossId).trim() ? String(raw.currentBossId).trim() : null,
    location: String(raw?.location ?? ''),
    message: String(raw?.message ?? ''),
    queue: queue
      .map((q: any) =>
        typeof q === 'string'
          ? { bossName: q, bossId: null, at: 0, note: '' }
          : {
              bossName: String(q?.bossName ?? q?.name ?? ''),
              bossId: q?.bossId != null && String(q.bossId).trim() ? String(q.bossId).trim() : null,
              at: toMs(q?.at ?? q?.eta),
              note: String(q?.note ?? ''),
            },
      )
      .filter((q: BotQueueItem) => q.bossName || q.bossId),
    updatedAt: toMs(raw?.updatedAt),
    intervalSec: Math.max(5, Number(raw?.intervalSec) || 30),
    version: String(raw?.version ?? ''),
  };
}

function normalize(raw: any): BotSuggestion {
  const ev = String(raw?.event ?? '').trim().toLowerCase();
  const event: BotEvent = ev === 'alive' || ev === 'spawned' || ev === 'spawn' ? 'alive' : 'killed';
  const at =
    event === 'alive'
      ? toMs(raw?.seenAt) || toMs(raw?.at) || toMs(raw?.killedAt) || toMs(raw?.sentAt)
      : toMs(raw?.killedAt) || toMs(raw?.at);
  const status = raw?.status === 'applied' || raw?.status === 'rejected' ? raw.status : 'new';
  return {
    id: String(raw?.id ?? ''),
    event,
    bossName: String(raw?.bossName ?? raw?.name ?? '').trim(),
    bossId: raw?.bossId != null && String(raw.bossId).trim() ? String(raw.bossId).trim() : null,
    at,
    killedAt: event === 'killed' ? at : 0,
    sentAt: toMs(raw?.sentAt) || at,
    hasPhoto: !!raw?.hasPhoto,
    note: String(raw?.note ?? ''),
    source: String(raw?.source ?? ''),
    status,
    handledBy: String(raw?.handledBy ?? ''),
    handledAt: raw?.handledAt != null ? toMs(raw.handledAt) : null,
  };
}

/**
 * Resp suggestions posted by the clan bot straight into Firestore (REST API, no
 * backend). The «Бот» page lists them; accepting one writes our kill time.
 */
@Injectable({ providedIn: 'root' })
export class RbBotService {
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private activityLog = inject(ActivityLogService);
  private col = collection(this.firestore, BOT_COLLECTION);

  // only while signed in (the menu badge subscribes from app start, before login);
  // a read error never kills the stream — it just shows nothing
  readonly suggestions$: Observable<BotSuggestion[]> = authState(this.auth).pipe(
    switchMap((u) =>
      u
        ? (collectionData(this.col, { idField: 'id' }) as Observable<any[]>).pipe(catchError(() => of([] as any[])))
        : of([] as any[]),
    ),
    map((rows) => (rows ?? []).map(normalize).filter((s) => s.at > 0).sort((a, b) => b.at - a.at)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** live bot status docs — Firestore pushes every heartbeat, no polling */
  readonly liveStatus$: Observable<BotLiveStatus[]> = authState(this.auth).pipe(
    switchMap((u) =>
      u
        ? (collectionData(collection(this.firestore, BOT_STATUS_COLLECTION), { idField: 'id' }) as Observable<any[]>).pipe(
            catchError(() => of([] as any[])),
          )
        : of([] as any[]),
    ),
    map((rows) => (rows ?? []).map(normalizeStatus).sort((a, b) => b.updatedAt - a.updatedAt)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** for the menu badge */
  readonly newCount$: Observable<number> = this.suggestions$.pipe(map((list) => list.filter((s) => s.status === 'new').length));

  /** the screenshot (data URL), loaded only when someone opens it */
  async photo(id: string): Promise<string | null> {
    const snap = await getDoc(doc(this.firestore, `${BOT_PHOTO_COLLECTION}/${id}`));
    const v = snap.exists() ? snap.data()?.['photo'] : null;
    return typeof v === 'string' && v ? (v.startsWith('data:') ? v : `data:image/jpeg;base64,${v}`) : null;
  }

  async setStatus(ids: string[], status: BotStatus): Promise<void> {
    if (!ids.length) return;
    const by = this.auth.currentUser?.email ?? 'unknown';
    const at = Date.now();
    // batches cap at 500 writes
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(this.firestore);
      for (const id of ids.slice(i, i + 400)) {
        batch.update(doc(this.firestore, `${BOT_COLLECTION}/${id}`), { status, handledBy: by, handledAt: at });
      }
      await batch.commit();
    }
  }

  /** pin suggestions whose name didn't match to a boss (sticks for everyone) */
  async setBossId(ids: string[], bossId: string): Promise<void> {
    const batch = writeBatch(this.firestore);
    for (const id of ids) batch.update(doc(this.firestore, `${BOT_COLLECTION}/${id}`), { bossId });
    await batch.commit();
  }

  async reopen(id: string): Promise<void> {
    await updateDoc(doc(this.firestore, `${BOT_COLLECTION}/${id}`), { status: 'new', handledBy: '', handledAt: null });
  }

  /** delete suggestions together with their screenshots */
  async remove(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 200) {
      const batch = writeBatch(this.firestore);
      for (const id of ids.slice(i, i + 200)) {
        batch.delete(doc(this.firestore, `${BOT_COLLECTION}/${id}`));
        batch.delete(doc(this.firestore, `${BOT_PHOTO_COLLECTION}/${id}`));
      }
      await batch.commit();
    }
    if (ids.length) this.activityLog.log('Удалил предложения бота', String(ids.length));
  }

  async removeOne(id: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `${BOT_COLLECTION}/${id}`));
    await deleteDoc(doc(this.firestore, `${BOT_PHOTO_COLLECTION}/${id}`)).catch(() => null);
  }
}

/** name → match key: lower case, ё→е, letters / digits only */
export function bossKey(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, '');
}
