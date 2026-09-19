import { Injectable, NgZone, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore,
  Query,
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import { Observable, catchError, combineLatest, map, of, shareReplay } from 'rxjs';

import { environment } from '../environments/environment';
import { ActivityLogService } from './activity-log.service';
import { JsonRb, RbJsonDataService } from './rb-json-data.service';
import { RespHistoryEntry } from './rb-json-resp.service';

const APP_NAME = 'nograde';
const MAX_HISTORY = 5;
// how a site account is shown on the NoGrade side, instead of its raw email
const NG_NAMES: Record<string, string> = { 'alexadmin@gmail.com': 'EvaElfie' };
const ngName = (who: string): string => NG_NAMES[who.trim().toLowerCase()] ?? who;
// newest N change-log rows, live — enough to give every boss its last few edits
const LOG_WINDOW = 300;

interface RespDoc {
  id: string;
  killTime?: Timestamp | null;
}

interface LogDoc {
  bossId?: string;
  prev?: Timestamp | null;
  by?: string;
  byEmail?: string | null;
  at?: Timestamp;
}

// Raid-boss kill times for the Lu4NoGrade site. They live in that project's own
// Firestore (rb-resp = latest kill time, rb-resp-log = who changed what), so this talks
// to it through a second, named Firebase app — the default app stays on our own
// project. Its rules are open (no sign-in needed). The boss catalog itself is the same
// db.json this site already ships, so only the time data comes from over there.
@Injectable({ providedIn: 'root' })
export class NoGradeRbService {
  private zone = inject(NgZone);
  private auth = inject(Auth);
  private catalog = inject(RbJsonDataService);
  private activityLog = inject(ActivityLogService);

  private db: Firestore = getFirestore(this.ngApp());
  private respCol = collection(this.db, 'rb-resp');
  private logCol = collection(this.db, 'rb-resp-log');

  private ngApp(): FirebaseApp {
    return getApps().find((a) => a.name === APP_NAME) ?? initializeApp(environment.noGradeFirebase, APP_NAME);
  }

  private live<T>(q: Query, toRow: (id: string, data: Record<string, any>) => T): Observable<T[]> {
    return new Observable<T[]>((sub) =>
      onSnapshot(
        q,
        (snap) => this.zone.run(() => sub.next(snap.docs.map((d) => toRow(d.id, d.data())))),
        (err) => this.zone.run(() => sub.error(err)),
      ),
    ).pipe(
      catchError((err) => {
        console.error('NoGrade Firestore read failed:', err);
        return of([] as T[]);
      }),
    );
  }

  private raidBosses$ = combineLatest([
    this.catalog.getCatalog(),
    this.live<RespDoc>(this.respCol, (id, d) => ({ id, killTime: d['killTime'] ?? null })),
    this.live<LogDoc>(query(this.logCol, orderBy('at', 'desc'), limit(LOG_WINDOW)), (_id, d) => d as LogDoc),
  ]).pipe(
    map(([bosses, resp, log]): JsonRb[] => {
      const killTimes = new Map(resp.map((r) => [r.id, r.killTime ?? null]));

      // log is newest-first; an entry stores the value it replaced, like RbJsonRespService's history
      const history = new Map<string, RespHistoryEntry[]>();
      for (const row of log) {
        if (!row.bossId || !row.at) continue;
        const list = history.get(row.bossId) ?? [];
        if (list.length >= MAX_HISTORY) continue;
        list.push({ killTime: row.prev ?? null, changedAt: row.at, changedBy: ngName(row.byEmail ?? row.by ?? '') });
        history.set(row.bossId, list);
      }

      return bosses.map((boss) => ({
        ...boss,
        lastDeadTime: killTimes.get(boss.id) ?? null,
        respHistory: history.get(boss.id) ?? [],
      }));
    }),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  getRaidBosses(): Observable<JsonRb[]> {
    return this.raidBosses$;
  }

  /**
   * @param opts.bossName  human name for the activity-log line (falls back to the id)
   * @param opts.silent    skip the activity-log line — for callers that log their own summary
   */
  async setKillTime(
    bossId: string,
    killTime: Date | null,
    opts: { bossName?: string; silent?: boolean } = {},
  ): Promise<void> {
    const id = (bossId ?? '').trim();
    if (!id) throw new Error('bossId is required');

    const ref = doc(this.db, 'rb-resp', id);
    const prev = ((await getDoc(ref)).data()?.['killTime'] as Timestamp | null | undefined) ?? null;
    const next = killTime ? Timestamp.fromDate(killTime) : null;

    await setDoc(ref, { killTime: next }, { merge: true });
    if ((prev?.toMillis() ?? 0) === (next?.toMillis() ?? 0)) return;

    const email = this.auth.currentUser?.email ?? null;
    const bossName = opts.bossName || id;
    // best-effort — a failed log write must not undo the edit
    try {
      await addDoc(this.logCol, {
        bossId: id,
        bossName,
        prev,
        next,
        by: email ? ngName(email) : 'неизвестно',
        byEmail: email,
        at: Timestamp.now(),
      });
    } catch (e) {
      console.error('NoGrade kill-time log write failed:', e);
    }

    if (!opts.silent) {
      const verb = !prev ? 'Добавил время убийства РБ (NG)' : !next ? 'Удалил время убийства РБ (NG)' : 'Изменил время убийства РБ (NG)';
      this.activityLog.log(verb, bossName);
    }
  }
}
