import { computed, signal } from '@angular/core';

import { RbStatus } from '../constants/status';
import { calculateStatus } from './rb-enrich';

/** status buckets the bookmark filter offers (several RbStatus values can share one) */
export type RbFilterGroup = 'inResp' | 'second' | 'soon' | 'hour' | 'killed' | 'missed' | 'unknown';
export type RbFilterSort = 'level' | 'resp' | 'name';

export const RB_FILTER_GROUPS: { key: RbFilterGroup; label: string; hint: string; tone: string }[] = [
  { key: 'inResp', label: 'В 1-м респе', hint: 'Сейчас в первом окне респа', tone: 'green' },
  { key: 'second', label: 'Во 2-м респе', hint: 'Сейчас во втором окне респа', tone: 'teal' },
  { key: 'soon', label: 'Скоро респ', hint: 'Скоро 1-й или 2-й респ', tone: 'amber' },
  { key: 'hour', label: '≤ 1 ч до респа', hint: 'До начала 1-го или 2-го респа меньше часа', tone: 'amber' },
  { key: 'killed', label: 'Убит, ждём', hint: 'Убит и ещё не в респе, или 1-й респ прошёл, ждём 2-й', tone: 'slate' },
  { key: 'missed', label: 'Проебан', hint: 'Оба окна респа прошли — время устарело', tone: 'red' },
  { key: 'unknown', label: 'Без времени', hint: 'Время убийства не указано', tone: 'gray' },
];

/** one-click combinations */
export const RB_FILTER_PRESETS: { label: string; hint: string; groups: RbFilterGroup[] }[] = [
  { label: 'Актуальные', hint: 'В 1-м / 2-м респе и скоро респ', groups: ['inResp', 'second', 'soon', 'hour'] },
  { label: 'Только в респе', hint: 'В 1-м или 2-м респе', groups: ['inResp', 'second'] },
  {
    label: 'Без проебаных',
    hint: 'Всё, кроме проебаных и тех, у кого нет времени',
    groups: ['inResp', 'second', 'soon', 'hour', 'killed'],
  },
];

const HOUR_MS = 60 * 60 * 1000;

export interface RbFilterItem {
  id?: string;
  name?: string;
  displayName?: string;
  lvl?: number | string;
  minResp?: Date | null;
  maxResp?: Date | null;
  secondMinResp?: Date | null;
  secondMaxResp?: Date | null;
}

function groupOf(status: RbStatus): RbFilterGroup {
  switch (status) {
    case RbStatus.InResp:
      return 'inResp';
    case RbStatus.SecondResp:
      return 'second';
    case RbStatus.SoonResp:
    case RbStatus.SoonSecondResp:
      return 'soon';
    case RbStatus.NotInResp:
    case RbStatus.FirstRespPassed:
      return 'killed';
    case RbStatus.Missed:
      return 'missed';
    default:
      return 'unknown';
  }
}

function ms(d: Date | null | undefined): number | null {
  return d instanceof Date ? d.getTime() : null;
}

/** start of the next (or current) resp window — for "ближе к респу" sorting */
function nextRespMs(it: RbFilterItem, now: number): number {
  const first = ms(it.minResp);
  const firstEnd = ms(it.maxResp);
  const second = ms(it.secondMinResp);
  const secondEnd = ms(it.secondMaxResp);
  if (first != null && (firstEnd == null || now <= firstEnd)) return first;
  if (second != null && (secondEnd == null || now <= secondEnd)) return second;
  return Number.POSITIVE_INFINITY; // missed / no time — to the bottom
}

interface Stored {
  groups?: RbFilterGroup[];
  lvlFrom?: number | null;
  lvlTo?: number | null;
  sort?: RbFilterSort;
}

/**
 * Bookmark-page boss filter: status buckets (empty = all), level range, name
 * search and sort. Everything but the search is remembered per page in
 * localStorage.
 */
export class RbFilterState {
  readonly groups = signal<Set<RbFilterGroup>>(new Set());
  readonly lvlFrom = signal<number | null>(null);
  readonly lvlTo = signal<number | null>(null);
  readonly search = signal('');
  readonly sort = signal<RbFilterSort>('level');

  /** how many filter settings differ from "show all" — for the toolbar badge */
  readonly activeCount = computed(
    () =>
      (this.groups().size ? 1 : 0) +
      (this.lvlFrom() != null || this.lvlTo() != null ? 1 : 0) +
      (this.search().trim() ? 1 : 0),
  );
  /** true when the result depends on the clock (status buckets / resp sort) */
  readonly needsNow = computed(() => this.groups().size > 0 || this.sort() === 'resp');

  constructor(private readonly storageKey: string) {
    try {
      const s = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Stored;
      const known = new Set(RB_FILTER_GROUPS.map((g) => g.key));
      this.groups.set(new Set((s.groups ?? []).filter((g) => known.has(g))));
      this.lvlFrom.set(Number.isFinite(s.lvlFrom) ? Number(s.lvlFrom) : null);
      this.lvlTo.set(Number.isFinite(s.lvlTo) ? Number(s.lvlTo) : null);
      if (s.sort === 'resp' || s.sort === 'name') this.sort.set(s.sort);
    } catch {
      /* defaults */
    }
  }

  private save(): void {
    try {
      const s: Stored = { groups: [...this.groups()], lvlFrom: this.lvlFrom(), lvlTo: this.lvlTo(), sort: this.sort() };
      localStorage.setItem(this.storageKey, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }

  toggleGroup(g: RbFilterGroup): void {
    const next = new Set(this.groups());
    if (next.has(g)) next.delete(g);
    else next.add(g);
    this.groups.set(next);
    this.save();
  }
  applyPreset(groups: RbFilterGroup[]): void {
    const cur = this.groups();
    const same = cur.size === groups.length && groups.every((g) => cur.has(g));
    this.groups.set(same ? new Set() : new Set(groups)); // clicking the active preset turns it off
    this.save();
  }
  isPreset(groups: RbFilterGroup[]): boolean {
    const cur = this.groups();
    return cur.size === groups.length && groups.every((g) => cur.has(g));
  }
  setLevel(from: number | null, to: number | null): void {
    this.lvlFrom.set(from);
    this.lvlTo.set(to);
    this.save();
  }
  setSort(s: RbFilterSort): void {
    this.sort.set(s);
    this.save();
  }
  reset(): void {
    this.groups.set(new Set());
    this.lvlFrom.set(null);
    this.lvlTo.set(null);
    this.search.set('');
    this.sort.set('level');
    this.save();
  }

  /** filter bucket of one boss right now */
  groupsOf(it: RbFilterItem, now: number): RbFilterGroup[] {
    const status = calculateStatus(it.minResp ?? null, it.maxResp ?? null, it.secondMinResp ?? null, it.secondMaxResp ?? null, now);
    const out: RbFilterGroup[] = [groupOf(status)];
    const first = ms(it.minResp);
    const second = ms(it.secondMinResp);
    const soonHour = (t: number | null) => t != null && t > now && t - now <= HOUR_MS;
    if (soonHour(first) || soonHour(second)) out.push('hour');
    return out;
  }

  /** `now` is only read when a status bucket or the resp sort is on */
  apply<T extends RbFilterItem>(items: T[], now: () => number): T[] {
    const groups = this.groups();
    const from = this.lvlFrom();
    const to = this.lvlTo();
    const q = this.search().trim().toLowerCase();
    const sort = this.sort();
    const t = this.needsNow() ? now() : 0;

    const out = items.filter((it) => {
      const lvl = Number(it.lvl ?? 0);
      if (from != null && lvl < from) return false;
      if (to != null && lvl > to) return false;
      if (q && !`${it.displayName ?? ''} ${it.name ?? ''}`.toLowerCase().includes(q)) return false;
      if (groups.size && !this.groupsOf(it, t).some((g) => groups.has(g))) return false;
      return true;
    });

    const byLvl = (a: T, b: T) => Number(a.lvl ?? 0) - Number(b.lvl ?? 0);
    const byName = (a: T, b: T) => String(a.displayName ?? a.name ?? '').localeCompare(String(b.displayName ?? b.name ?? ''));
    if (sort === 'name') return out.sort((a, b) => byName(a, b) || byLvl(a, b));
    if (sort === 'resp') return out.sort((a, b) => nextRespMs(a, t) - nextRespMs(b, t) || byLvl(a, b));
    return out.sort((a, b) => byLvl(a, b) || byName(a, b));
  }
}
