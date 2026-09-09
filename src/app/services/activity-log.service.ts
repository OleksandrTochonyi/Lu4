import { Injectable, inject } from '@angular/core';
import {
  CollectionReference,
  Firestore,
  addDoc,
  collection,
  collectionData,
  limit,
  orderBy,
  query,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { AuthService } from './auth.service';

/** a page visit vs. a data change (add / edit / delete / …) */
export type ActivityKind = 'nav' | 'action';

export interface ActivityEntry {
  id: string;
  /** lowercased email of who did it */
  actor: string;
  /** short verb phrase, e.g. "Добавил убийство" */
  action: string;
  /** free-text target, e.g. a boss / item name */
  detail: string;
  /** 'nav' = opened a tab, 'action' = changed something */
  kind: ActivityKind;
  at: number;
}

/**
 * Rows read per stream. Actions and nav visits live in SEPARATE collections, so a
 * busy day of tab-hopping can never push data changes out of view, and vice
 * versa. Each window is filtered per-user client-side (no `where actor ==` — that
 * needs a composite index), so it's kept well above the ~50/user the dialog shows.
 */
const ACTION_READ_LIMIT = 300;
const NAV_READ_LIMIT = 300;

/** the one and only verb a page visit is logged under (see app.component) */
const NAV_ACTION = 'Открыл';

function normalize(raw: any): ActivityEntry {
  const action = String(raw?.action ?? '');
  const rawKind = raw?.kind;
  // The verb wins: a page visit is ALWAYS 'nav', even for an old row that was
  // written to `activity-log` with `kind: 'action'` before nav got its own
  // collection. Otherwise trust the stored kind, else assume a data change.
  const kind: ActivityKind =
    action === NAV_ACTION
      ? 'nav'
      : rawKind === 'nav' || rawKind === 'action'
        ? rawKind
        : 'action';
  return {
    id: String(raw?.id ?? ''),
    actor: String(raw?.actor ?? '').trim().toLowerCase(),
    action,
    detail: String(raw?.detail ?? ''),
    kind,
    at: Number(raw?.at) || 0,
  };
}

/**
 * Best-effort audit trail. Any service/component can call `log(action, detail, kind)`;
 * it stamps the current user + time into Firestore. `kind: 'action'` (the default)
 * goes to `activity-log`, `kind: 'nav'` (tab visits) to `activity-nav` — two
 * independent collections so each keeps its own ~50-per-person history on the
 * `/admin/users` page. Fire-and-forget — a failed write never blocks the action
 * it was recording.
 *
 * No pruning: the collections grow slowly; clear them in the console if they ever
 * get big. The 300-row read caps keep the UI bounded.
 */
@Injectable({ providedIn: 'root' })
export class ActivityLogService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private actionsCol = collection(this.firestore, 'activity-log');
  private navCol = collection(this.firestore, 'activity-nav');
  private myEmail = '';

  /** recent data changes (add / edit / delete / …), newest first */
  readonly recent$: Observable<ActivityEntry[]> = this.stream(this.actionsCol, ACTION_READ_LIMIT, 'action');
  /** recent tab visits, newest first */
  readonly recentNav$: Observable<ActivityEntry[]> = this.stream(this.navCol, NAV_READ_LIMIT, 'nav');

  constructor() {
    this.auth.user$.subscribe((u) => {
      this.myEmail = String(u?.email ?? '').trim().toLowerCase();
    });
  }

  private stream(
    col: CollectionReference,
    rows: number,
    kind: ActivityKind,
  ): Observable<ActivityEntry[]> {
    return (
      collectionData(query(col, orderBy('at', 'desc'), limit(rows)), {
        idField: 'id',
      }) as Observable<any[]>
    ).pipe(
      // keep only rows of this stream's kind — guards against nav rows that were
      // written to `activity-log` before the split into two collections
      map((list) => (list ?? []).map(normalize).filter((e) => e.kind === kind)),
    );
  }

  log(action: string, detail: unknown = '', kind: ActivityKind = 'action'): void {
    const actor = this.myEmail;
    if (!actor) return;
    const col = kind === 'nav' ? this.navCol : this.actionsCol;
    void addDoc(col, {
      actor,
      action: String(action).slice(0, 80),
      detail: String(detail ?? '').slice(0, 200),
      kind: kind === 'nav' ? 'nav' : 'action',
      at: Date.now(),
    }).catch(() => null);
  }
}
