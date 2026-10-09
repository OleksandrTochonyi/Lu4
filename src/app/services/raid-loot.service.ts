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

import { ActivityLogService } from './activity-log.service';
import { RespVoiceService } from './resp-voice.service';

/**
 * RB kill log + loot / sale / payout tracking for the `/raids` page.
 *
 *  - `raid-kills`  — one doc per boss kill: which packs + individual players
 *    attended, what dropped (each drop line has a stable `id`).
 *  - `raid-sales`  — one doc per sold drop line: price, which kill it
 *    came from, and the payout split snapshotted at the moment of the sale
 *    (so later config/participant changes don't rewrite history) — each share
 *    (bank / leader / every mercenary) tracks whether it was actually paid out.
 *  - `raid-payout-config/default` — the clan-wide split rule (leader + bank% +
 *    mercenary% per attending player).
 *
 * "Available drop" (what we're still holding) isn't its own collection — it's
 * derived client-side as kills.drops minus sales for the same (killId, dropId).
 */

export interface RaidParticipant {
  groupId: string;
  groupName: string;
  userId: string;
  name: string;
}

/** where one drop line of a kill farmed with Feels / another clan goes */
export type DropDest = 'pack' | 'clan' | 'none';

/** one person's cut of a clan sale */
export interface ClanPersonShare {
  userId: string;
  name: string;
  amount: number;
  paid: boolean;
  paidAt: number | null;
}

/** one pack's equal cut of a clan sale */
export interface ClanPackShare {
  groupId: string;
  groupName: string;
  amount: number;
  /** OUR pack (the payout leader's): its cut is split like a normal sale — bank % →
   *  mercenaries → leader. null for every other pack (paid as a whole). */
  split: SalePayout | null;
  /** legacy (early clan sales split per person) — new sales keep it empty */
  people: ClanPersonShare[];
  /** pack-level flag — for a pack paid as a whole */
  paid: boolean;
  paidAt: number | null;
}

/** what one «выдано» click on a clan sale targets */
export type ClanShareTarget =
  | { kind: 'pack' }
  | { kind: 'person'; userId: string }
  | { kind: 'bank' }
  | { kind: 'leader' }
  | { kind: 'merc'; userId: string };

/** a sale from «Склад клана»: price split equally per pack present, then per person */
export interface RaidClanSale {
  id: string;
  killId: string;
  dropId: string;
  bossName: string;
  itemName: string;
  icon: string | null;
  catalogId: string | null;
  grade: string | null;
  qty: number;
  price: number;
  packs: ClanPackShare[];
  soldAt: number;
  soldBy: string;
  locked: boolean;
}

export type NewRaidClanSale = Omit<RaidClanSale, 'id' | 'soldAt' | 'soldBy' | 'locked'>;

/** every share of this pack's cut is paid */
export function clanPackSettled(p: ClanPackShare): boolean {
  if (p.split) {
    return p.split.bank.paid && p.split.leader.paid && Object.values(p.split.mercenaries).every((m) => m.paid);
  }
  return p.people.length ? p.people.every((x) => x.paid) : p.paid;
}

/** every share of a clan sale is paid */
export function clanSaleSettled(s: RaidClanSale): boolean {
  return s.packs.every(clanPackSettled);
}

/** mark one share (or the whole pack) of a clan sale paid / not paid */
function markClanShare(p: ClanPackShare, t: ClanShareTarget, paid: boolean, at: number | null): ClanPackShare {
  const mark = <T extends { paid: boolean; paidAt: number | null }>(x: T): T => ({ ...x, paid, paidAt: paid ? (x.paidAt ?? at) : null });
  const sp = p.split;
  switch (t.kind) {
    case 'pack':
      if (sp) {
        const mercenaries = Object.fromEntries(Object.entries(sp.mercenaries).map(([k, m]) => [k, mark(m)]));
        return { ...p, split: { ...sp, bank: mark(sp.bank), leader: mark(sp.leader), mercenaries } };
      }
      return p.people.length ? { ...p, people: p.people.map(mark) } : mark(p);
    case 'person':
      return { ...p, people: p.people.map((x) => (x.userId === t.userId ? mark(x) : x)) };
    case 'bank':
      return sp ? { ...p, split: { ...sp, bank: mark(sp.bank) } } : p;
    case 'leader':
      return sp ? { ...p, split: { ...sp, leader: mark(sp.leader) } } : p;
    case 'merc':
      return sp && sp.mercenaries[t.userId]
        ? { ...p, split: { ...sp, mercenaries: { ...sp.mercenaries, [t.userId]: mark(sp.mercenaries[t.userId]) } } }
        : p;
  }
}

function normalizeClanSale(raw: any): RaidClanSale {
  const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    id: String(raw?.id ?? ''),
    killId: String(raw?.killId ?? ''),
    dropId: String(raw?.dropId ?? ''),
    bossName: String(raw?.bossName ?? ''),
    itemName: String(raw?.itemName ?? ''),
    icon: raw?.icon ? String(raw.icon) : null,
    catalogId: raw?.catalogId ? String(raw.catalogId) : null,
    grade: raw?.grade ? String(raw.grade) : null,
    qty: Math.max(0, Math.round(n(raw?.qty))),
    price: n(raw?.price),
    packs: (Array.isArray(raw?.packs) ? raw.packs : []).map((p: any) => ({
      groupId: String(p?.groupId ?? ''),
      groupName: String(p?.groupName ?? ''),
      amount: n(p?.amount),
      split: p?.split ? normalizePayout(p.split) : null,
      paid: !!p?.paid,
      paidAt: p?.paidAt != null ? n(p.paidAt) : null,
      people: (Array.isArray(p?.people) ? p.people : []).map((x: any) => ({
        userId: String(x?.userId ?? ''),
        name: String(x?.name ?? ''),
        amount: n(x?.amount),
        paid: !!x?.paid,
        paidAt: x?.paidAt != null ? n(x.paidAt) : null,
      })),
    })),
    soldAt: n(raw?.soldAt) || Date.now(),
    soldBy: String(raw?.soldBy ?? ''),
    locked: !!raw?.locked,
  };
}

export interface RaidDrop {
  /** stable id within the kill doc, so a sale can reference this exact line */
  id: string;
  catalogId: string | null;
  name: string;
  icon: string | null;
  grade: string | null;
  qty: number;
  /** legacy mirror of `dest === 'pack'` (kept so older readers still work) */
  ours: boolean;
  /** kill farmed with Feels / another clan: our «Дроп» (pack), «Склад клана» (clan), or not ours */
  dest: DropDest;
  /** free note on this item (who it's for, enchant, …) — shown on hover in «Дроп» */
  comment: string;
}

export interface RaidKill {
  id: string;
  bossId: string;
  bossName: string;
  bossIcon: string | null;
  bossLevel: number | null;
  killedAt: number;
  packIds: string[];
  packNames: string[];
  participants: RaidParticipant[];
  drops: RaidDrop[];
  note: string;
  /** farmed together with Feels — shown with its own tag; the drop may or may not be there */
  withFeels: boolean;
  /** farmed together with another clan: its drop stays in the kill history and only
   *  drops marked `ours` reach the balance */
  withClan: boolean;
  /** which clan (optional, free text) */
  clanName: string;
  createdBy: string;
  createdAt: number;
}

export type NewRaidKill = Omit<RaidKill, 'id' | 'createdBy' | 'createdAt'>;

/** one recipient's cut of a sale, with paid/unpaid tracking */
export interface PayoutShare {
  amount: number;
  paid: boolean;
  paidAt: number | null;
}

export interface MercShare extends PayoutShare {
  groupId: string;
  name: string;
}

export interface SalePayout {
  bankPercent: number;
  bank: PayoutShare;
  leaderId: string;
  leaderName: string;
  leader: PayoutShare;
  mercenaryPercent: number;
  /** keyed by userId — a map (not an array) so a single share can be patched by dot-path */
  mercenaries: Record<string, MercShare>;
}

export interface RaidSale {
  id: string;
  killId: string;
  dropId: string;
  bossName: string;
  itemName: string;
  icon: string | null;
  catalogId: string | null;
  grade: string | null;
  qty: number;
  price: number;
  payout: SalePayout;
  soldAt: number;
  soldBy: string;
  /** finalized by "Всем выдано" — payout buttons are frozen until unlocked */
  locked: boolean;
}

export type NewRaidSale = Omit<RaidSale, 'id' | 'soldAt' | 'soldBy' | 'locked'>;

/** one item on a "На продаже" listing — an aggregate (across kills) of stock put up
 *  for sale: how much was listed, at what per-unit price, and how much actually sold */
export interface RaidListingLine {
  /** lowercased item name — the "Дроп на складе" group identity */
  key: string;
  name: string;
  icon: string | null;
  grade: string | null;
  catalogId: string | null;
  listedQty: number;
  unitPrice: number;
  soldQty: number;
}

export interface RaidListing {
  id: string;
  name: string;
  /** draft = still open; closed = archived without acting (no sales, stock untouched);
   *  sold = "продать и попилить" ran (real sales created) */
  status: 'draft' | 'closed' | 'sold';
  lines: RaidListingLine[];
  createdAt: number;
  createdBy: string;
  settledAt: number | null;
  settledBy: string;
}

export type NewRaidListing = Pick<RaidListing, 'name' | 'status' | 'lines'>;

export interface ConfigMercenary {
  groupId: string;
  userId: string;
  name: string;
}

export interface PayoutConfig {
  leaderGroupId: string;
  leaderUserId: string;
  leaderName: string;
  bankPercent: number;
  mercenaryPercent: number;
  /**
   * The fixed roster of players who CAN be paid as a mercenary — not every
   * kill participant qualifies, only these (and only when they also attended
   * that specific kill). Everyone else who was there gets nothing.
   */
  mercenaries: ConfigMercenary[];
  updatedAt: number;
  updatedBy: string;
}

/** a payout recipient path, used to target one nested `paid` flag */
export type PayoutTarget = { kind: 'bank' | 'leader' } | { kind: 'merc'; userId: string };

export interface RosterPresetPlayer {
  groupId: string;
  userId: string;
  name: string;
}

/** the "who usually shows up" default roster — pre-fills a new kill's pack/participant
 *  pickers, but every kill can still add/remove people freely on top of it */
export interface RosterPreset {
  players: RosterPresetPlayer[];
  updatedAt: number;
  updatedBy: string;
}

const CONFIG_DOC_ID = 'default';
const ROSTER_PRESET_DOC_ID = 'default';

function toInt(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDrop(raw: any): RaidDrop {
  const dest: DropDest =
    raw?.dest === 'pack' || raw?.dest === 'clan' || raw?.dest === 'none'
      ? raw.dest
      : raw?.ours === false
        ? 'none'
        : 'pack';
  return {
    id: String(raw?.id ?? ''),
    catalogId: raw?.catalogId ? String(raw.catalogId) : null,
    name: String(raw?.name ?? ''),
    icon: raw?.icon ? String(raw.icon) : null,
    grade: raw?.grade ? String(raw.grade) : null,
    qty: toInt(raw?.qty),
    ours: dest === 'pack',
    dest,
    comment: String(raw?.comment ?? ''),
  };
}

function normalizeParticipant(raw: any): RaidParticipant {
  return {
    groupId: String(raw?.groupId ?? ''),
    groupName: String(raw?.groupName ?? ''),
    userId: String(raw?.userId ?? ''),
    name: String(raw?.name ?? ''),
  };
}

function normalizeKill(raw: any): RaidKill {
  return {
    id: String(raw?.id ?? ''),
    bossId: String(raw?.bossId ?? ''),
    bossName: String(raw?.bossName ?? ''),
    bossIcon: raw?.bossIcon ? String(raw.bossIcon) : null,
    bossLevel: Number.isFinite(Number(raw?.bossLevel)) ? Number(raw.bossLevel) : null,
    killedAt: toNum(raw?.killedAt) || Date.now(),
    packIds: Array.isArray(raw?.packIds) ? raw.packIds.map(String) : [],
    packNames: Array.isArray(raw?.packNames) ? raw.packNames.map(String) : [],
    participants: Array.isArray(raw?.participants) ? raw.participants.map(normalizeParticipant) : [],
    drops: Array.isArray(raw?.drops) ? raw.drops.map(normalizeDrop) : [],
    note: String(raw?.note ?? ''),
    withFeels: !!raw?.withFeels,
    withClan: !!raw?.withClan,
    clanName: String(raw?.clanName ?? ''),
    createdBy: String(raw?.createdBy ?? ''),
    createdAt: toNum(raw?.createdAt),
  };
}

function normalizeShare(raw: any): PayoutShare {
  return {
    amount: toNum(raw?.amount),
    paid: !!raw?.paid,
    paidAt: raw?.paidAt != null ? toNum(raw.paidAt) : null,
  };
}

function normalizeMerc(raw: any): MercShare {
  return {
    ...normalizeShare(raw),
    groupId: String(raw?.groupId ?? ''),
    name: String(raw?.name ?? ''),
  };
}

function normalizePayout(raw: any): SalePayout {
  const mercRaw = raw?.mercenaries ?? {};
  const mercenaries: Record<string, MercShare> = {};
  for (const [uid, v] of Object.entries<any>(mercRaw)) mercenaries[uid] = normalizeMerc(v);
  return {
    bankPercent: toNum(raw?.bankPercent),
    bank: normalizeShare(raw?.bank),
    leaderId: String(raw?.leaderId ?? ''),
    leaderName: String(raw?.leaderName ?? ''),
    leader: normalizeShare(raw?.leader),
    mercenaryPercent: toNum(raw?.mercenaryPercent),
    mercenaries,
  };
}

function normalizeSale(raw: any): RaidSale {
  return {
    id: String(raw?.id ?? ''),
    killId: String(raw?.killId ?? ''),
    dropId: String(raw?.dropId ?? ''),
    bossName: String(raw?.bossName ?? ''),
    itemName: String(raw?.itemName ?? ''),
    icon: raw?.icon ? String(raw.icon) : null,
    catalogId: raw?.catalogId ? String(raw.catalogId) : null,
    grade: raw?.grade ? String(raw.grade) : null,
    qty: toInt(raw?.qty),
    price: toNum(raw?.price),
    payout: normalizePayout(raw?.payout),
    soldAt: toNum(raw?.soldAt) || Date.now(),
    soldBy: String(raw?.soldBy ?? ''),
    locked: !!raw?.locked,
  };
}

function normalizeListingLine(raw: any): RaidListingLine {
  return {
    key: String(raw?.key ?? ''),
    name: String(raw?.name ?? ''),
    icon: raw?.icon ? String(raw.icon) : null,
    grade: raw?.grade ? String(raw.grade) : null,
    catalogId: raw?.catalogId ? String(raw.catalogId) : null,
    listedQty: toInt(raw?.listedQty),
    unitPrice: toNum(raw?.unitPrice),
    soldQty: Math.max(0, Math.round(Number(raw?.soldQty) || 0)),
  };
}

function normalizeListing(raw: any): RaidListing {
  const status = raw?.status;
  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? ''),
    // 'template' is the old name for what's now 'closed'
    status: status === 'sold' ? 'sold' : status === 'closed' || status === 'template' ? 'closed' : 'draft',
    lines: Array.isArray(raw?.lines) ? raw.lines.map(normalizeListingLine) : [],
    createdAt: toNum(raw?.createdAt) || Date.now(),
    createdBy: String(raw?.createdBy ?? ''),
    settledAt: raw?.settledAt != null ? toNum(raw.settledAt) : null,
    settledBy: String(raw?.settledBy ?? ''),
  };
}

function targetPath(target: PayoutTarget): string {
  if (target.kind === 'merc') return `payout.mercenaries.${target.userId}`;
  return target.kind === 'bank' ? 'payout.bank' : 'payout.leader';
}

@Injectable({ providedIn: 'root' })
export class RaidLootService {
  private firestore = inject(Firestore);
  private activityLog = inject(ActivityLogService);
  private voice = inject(RespVoiceService);
  private killsCol = collection(this.firestore, 'raid-kills');
  private salesCol = collection(this.firestore, 'raid-sales');
  private listingsCol = collection(this.firestore, 'raid-listings');

  readonly kills$: Observable<RaidKill[]> = (
    collectionData(this.killsCol, { idField: 'id' }) as Observable<any[]>
  ).pipe(map((list) => (list ?? []).map(normalizeKill).sort((a, b) => b.killedAt - a.killedAt)));

  readonly sales$: Observable<RaidSale[]> = (
    collectionData(this.salesCol, { idField: 'id' }) as Observable<any[]>
  ).pipe(map((list) => (list ?? []).map(normalizeSale).sort((a, b) => b.soldAt - a.soldAt)));

  readonly listings$: Observable<RaidListing[]> = (
    collectionData(this.listingsCol, { idField: 'id' }) as Observable<any[]>
  ).pipe(map((list) => (list ?? []).map(normalizeListing).sort((a, b) => b.createdAt - a.createdAt)));

  readonly config$: Observable<PayoutConfig | null> = (
    docData(doc(this.firestore, `raid-payout-config/${CONFIG_DOC_ID}`)) as Observable<any>
  ).pipe(
    map((raw) =>
      raw
        ? {
            leaderGroupId: String(raw.leaderGroupId ?? ''),
            leaderUserId: String(raw.leaderUserId ?? ''),
            leaderName: String(raw.leaderName ?? ''),
            bankPercent: toNum(raw.bankPercent),
            mercenaryPercent: toNum(raw.mercenaryPercent),
            mercenaries: Array.isArray(raw.mercenaries)
              ? raw.mercenaries.map((m: any) => ({
                  groupId: String(m?.groupId ?? ''),
                  userId: String(m?.userId ?? ''),
                  name: String(m?.name ?? ''),
                }))
              : [],
            updatedAt: toNum(raw.updatedAt),
            updatedBy: String(raw.updatedBy ?? ''),
          }
        : null,
    ),
  );

  readonly rosterPreset$: Observable<RosterPreset | null> = (
    docData(doc(this.firestore, `raid-roster-preset/${ROSTER_PRESET_DOC_ID}`)) as Observable<any>
  ).pipe(
    map((raw) =>
      raw
        ? {
            players: Array.isArray(raw.players)
              ? raw.players.map((p: any) => ({
                  groupId: String(p?.groupId ?? ''),
                  userId: String(p?.userId ?? ''),
                  name: String(p?.name ?? ''),
                }))
              : [],
            updatedAt: toNum(raw.updatedAt),
            updatedBy: String(raw.updatedBy ?? ''),
          }
        : null,
    ),
  );

  async saveRosterPreset(players: RosterPresetPlayer[], actorEmail: string): Promise<void> {
    await setDoc(doc(this.firestore, `raid-roster-preset/${ROSTER_PRESET_DOC_ID}`), {
      players,
      updatedAt: Date.now(),
      updatedBy: actorEmail || 'неизвестно',
    });
    this.activityLog.log('Изменил состав пака по умолчанию');
    this.voice.action('rosterPreset');
  }

  async addKill(data: NewRaidKill, actorEmail: string): Promise<string> {
    if (!data.bossId) throw new Error('Не выбран рейд-босс');
    const ref = doc(this.killsCol);
    await setDoc(ref, {
      ...data,
      createdBy: actorEmail || 'неизвестно',
      createdAt: Date.now(),
    });
    this.activityLog.log('Отметил убийство РБ', data.bossName);
    this.voice.action('raidKill', { id: data.bossId, name: data.bossName });
    return ref.id;
  }

  async updateKill(id: string, data: Partial<NewRaidKill>): Promise<void> {
    await updateDoc(doc(this.firestore, `raid-kills/${id}`), { ...data });
    this.activityLog.log('Изменил убийство РБ', data.bossName ?? '');
    this.voice.action('raidKillEdit');
  }

  async removeKill(id: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `raid-kills/${id}`));
    this.activityLog.log('Удалил убийство РБ');
    this.voice.action('raidKillDelete');
  }

  /** @param quiet no voice line — for bulk sales (a whole list), which say their own */
  async addSale(data: NewRaidSale, actorEmail: string, quiet = false): Promise<string> {
    if (!data.killId) throw new Error('Не указано, с какого убийства продан дроп');
    if (data.qty <= 0) throw new Error('Количество должно быть больше нуля');
    const ref = doc(this.salesCol);
    await setDoc(ref, {
      ...data,
      soldBy: actorEmail || 'неизвестно',
      soldAt: Date.now(),
      locked: false,
    });
    this.activityLog.log('Продал дроп', `${data.itemName} ×${data.qty}`);
    if (!quiet) this.voice.action('raidSale');
    return ref.id;
  }

  async removeSale(id: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `raid-sales/${id}`));
    this.activityLog.log('Удалил продажу');
    this.voice.action('raidSaleDelete');
  }

  async addListing(data: NewRaidListing, actorEmail: string): Promise<string> {
    if (!data.lines?.length) throw new Error('Список пуст');
    const ref = doc(this.listingsCol);
    await setDoc(ref, {
      ...data,
      createdBy: actorEmail || 'неизвестно',
      createdAt: Date.now(),
      settledAt: null,
      settledBy: '',
    });
    this.activityLog.log('Создал список на продажу', data.name);
    this.voice.action('listingCreate');
    return ref.id;
  }

  async updateListing(id: string, data: Partial<Omit<RaidListing, 'id'>>): Promise<void> {
    await updateDoc(doc(this.firestore, `raid-listings/${id}`), { ...data });
    if (data.status === 'sold') {
      this.activityLog.log('Продал и попилил список', data.name ?? '');
      this.voice.action('raidSplit');
    } else if (data.status === 'closed') {
      this.activityLog.log('Закрыл список на продажу', data.name ?? '');
      this.voice.action('listingClose');
    } else {
      this.activityLog.log('Изменил список на продажу', data.name ?? '');
      this.voice.action('listingEdit');
    }
  }

  async removeListing(id: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `raid-listings/${id}`));
    this.activityLog.log('Удалил список на продажу');
    this.voice.action('listingDelete');
  }

  /** mark one payout share (bank / leader / one mercenary) of a sale as paid or not */
  async setSharePaid(saleId: string, target: PayoutTarget, paid: boolean): Promise<void> {
    const path = targetPath(target);
    await updateDoc(doc(this.firestore, `raid-sales/${saleId}`), {
      [`${path}.paid`]: paid,
      [`${path}.paidAt`]: paid ? Date.now() : null,
    });
  }

  /** finalize (or reopen) a sale — locked sales can't have their payout buttons touched */
  async setSaleLocked(saleId: string, locked: boolean): Promise<void> {
    await updateDoc(doc(this.firestore, `raid-sales/${saleId}`), { locked });
  }

/* ------------------------------------------------------- «Склад клана» sales */

  private clanSalesCol = collection(this.firestore, 'raid-clan-sales');

  readonly clanSales$: Observable<RaidClanSale[]> = (
    collectionData(this.clanSalesCol, { idField: 'id' }) as Observable<any[]>
  ).pipe(map((list) => (list ?? []).map(normalizeClanSale).sort((a, b) => b.soldAt - a.soldAt)));

  async addClanSale(data: NewRaidClanSale, actorEmail: string): Promise<string> {
    if (!data.killId) throw new Error('Не указано, с какого убийства продан дроп');
    if (data.qty <= 0) throw new Error('Количество должно быть больше нуля');
    const ref = doc(this.clanSalesCol);
    await setDoc(ref, { ...data, soldBy: actorEmail || 'неизвестно', soldAt: Date.now(), locked: false });
    this.activityLog.log('Продал дроп со склада клана', `${data.itemName} ×${data.qty}`);
    this.voice.action('raidSale');
    return ref.id;
  }

  async removeClanSale(id: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `raid-clan-sales/${id}`));
    this.activityLog.log('Удалил продажу со склада клана');
    this.voice.action('raidSaleDelete');
  }

  /** mark one share of a clan sale paid / not paid. Closing the sale is a separate,
   *  confirmed step — until then every mark can be undone. */
  async setClanSharePaid(sale: RaidClanSale, groupId: string, target: ClanShareTarget, paid: boolean): Promise<void> {
    const at = Date.now();
    const packs = sale.packs.map((p) => (p.groupId === groupId ? markClanShare(p, target, paid, at) : p));
    await updateDoc(doc(this.firestore, `raid-clan-sales/${sale.id}`), { packs });
  }

  /** edit qty / price — the split is recomputed, so payout marks start over */
  async updateClanSale(id: string, data: Pick<RaidClanSale, 'qty' | 'price' | 'packs'>): Promise<void> {
    await updateDoc(doc(this.firestore, `raid-clan-sales/${id}`), { ...data, locked: false });
    this.activityLog.log('Изменил продажу со склада клана', `×${data.qty}`);
  }

  /** every share of every given clan sale → paid, and lock them («Всем выдано») */
  async settleClanSales(sales: RaidClanSale[]): Promise<void> {
    const at = Date.now();
    await Promise.all(
      sales.map((s) =>
        updateDoc(doc(this.firestore, `raid-clan-sales/${s.id}`), {
          locked: true,
          packs: s.packs.map((p) => markClanShare(p, { kind: 'pack' }, true, at)),
        }),
      ),
    );
  }

  async setClanSaleLocked(id: string, locked: boolean): Promise<void> {
    await updateDoc(doc(this.firestore, `raid-clan-sales/${id}`), { locked });
  }

  async saveConfig(cfg: Omit<PayoutConfig, 'updatedAt' | 'updatedBy'>, actorEmail: string): Promise<void> {
    await setDoc(
      doc(this.firestore, `raid-payout-config/${CONFIG_DOC_ID}`),
      { ...cfg, updatedAt: Date.now(), updatedBy: actorEmail || 'неизвестно' },
      { merge: true },
    );
    this.activityLog.log('Изменил настройки выплат');
    this.voice.action('payoutConfig');
  }

  async getConfigOnce(): Promise<PayoutConfig | null> {
    return firstValueFrom(this.config$.pipe(take(1)));
  }
}
