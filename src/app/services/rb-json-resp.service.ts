import { Injectable, Injector, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore, collection, collectionData, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { Timestamp } from 'firebase/firestore';
import { Observable, map } from 'rxjs';

import { MessageService } from 'primeng/api';

import { ActivityLogService } from './activity-log.service';
import { NgMirrorService } from './ng-mirror.service';
import { NoGradeRbService } from './nograde-rb.service';

const MAX_HISTORY = 5;

export interface RespHistoryEntry {
  killTime: Timestamp | null;
  changedAt: Timestamp;
  changedBy: string;
}

export interface RbRespRecord {
  bossId: string;
  killTime: Timestamp | null;
  history: RespHistoryEntry[];
}

// Kill-time storage for the db.json raid-boss catalog, kept in its own collection
// (separate from the legacy `raid-boss` docs) so it never mixes with the old app's
// data. Doc id = the db.json monster id. Every time the kill time changes, the
// previous value is pushed onto `history` (capped at 5) along with who changed it
// and when — an audit trail, not just the latest value.
@Injectable({
  providedIn: 'root',
})
export class RbJsonRespService {
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private activityLog = inject(ActivityLogService);
  private ngMirror = inject(NgMirrorService);
  private messages = inject(MessageService, { optional: true });
  // NoGradeRbService → RbJsonDataService → this service: resolved lazily to avoid the cycle
  private injector = inject(Injector);
  private respCollection = collection(this.firestore, 'rb-resp-time');

  /** Map of db.json monster id -> its kill-time record. */
  getRespTimes(): Observable<Map<string, RbRespRecord>> {
    return (collectionData(this.respCollection, { idField: 'bossId' }) as Observable<RbRespRecord[]>).pipe(
      map((rows) => {
        const result = new Map<string, RbRespRecord>();
        for (const row of rows ?? []) {
          result.set(row.bossId, row);
        }
        return result;
      })
    );
  }

  /**
   * @param opts.bossName  human name for the activity-log line (falls back to the id)
   * @param opts.silent     skip the activity-log write — for flows that already log
   *                        their own action (e.g. the raids kill dialog)
   * @param opts.mirror     false = never copy to Bookmarks NG (bulk flows: sync from NG,
   *                        «Очистить респы»). Otherwise a set time is copied when the
   *                        «Дублировать в NG» switch is on; clearing is never copied.
   */
  async setKillTime(
    bossId: string,
    killTime: Date | null,
    opts: { bossName?: string; silent?: boolean; mirror?: boolean } = {},
  ): Promise<void> {
    const id = (bossId ?? '').trim();
    if (!id) throw new Error('bossId is required');

    const ref = doc(this.firestore, `rb-resp-time/${id}`);
    const snap = await getDoc(ref);
    const existing = snap.exists() ? (snap.data() as RbRespRecord) : null;

    // Log a history entry for every change, including the very first time this boss's
    // kill time is ever set — that's still "who set it and when", worth keeping just
    // like any later change (killTime: null here means "was never set before").
    const history = [...(existing?.history ?? [])];
    history.unshift({
      killTime: existing?.killTime ?? null,
      changedAt: Timestamp.now(),
      changedBy: this.auth.currentUser?.email ?? 'unknown',
    });
    history.length = Math.min(history.length, MAX_HISTORY);

    await setDoc(
      ref,
      {
        bossId: id,
        killTime: killTime ? Timestamp.fromDate(killTime) : null,
        history,
      },
      { merge: true }
    );

    if (!opts.silent) {
      const had = (existing?.killTime ?? null) != null;
      const has = killTime != null;
      const verb =
        !had && has
          ? 'Добавил время убийства РБ'
          : had && !has
            ? 'Удалил время убийства РБ'
            : had && has
              ? 'Изменил время убийства РБ'
              : null; // clearing an already-empty time — nothing worth logging
      if (verb) this.activityLog.log(verb, opts.bossName || id);
    }

    if (killTime && opts.mirror !== false && this.ngMirror.enabled()) {
      // best-effort: ours is already saved, a failed NG write only warns
      try {
        await this.injector.get(NoGradeRbService).setKillTime(id, killTime, { bossName: opts.bossName, silent: true });
      } catch (e) {
        console.error('NG mirror write failed:', e);
        this.messages?.add({
          severity: 'warn',
          summary: 'В NG не записалось',
          detail: `${opts.bossName || id}: у нас время сохранено, в Bookmarks NG — нет`,
          life: 5000,
        });
      }
    }
  }
}
