import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService, MessageService } from 'primeng/api';

import { AuthService } from '../../services/auth.service';
import { OnboardingService } from '../../services/onboarding.service';
import { GuidedTourComponent, TourStep } from '../shared/guided-tour/guided-tour.component';
import { ConstPartyGroup, ConstPartyService, ConstPartyUser } from '../../services/const-party.service';
import { JsonRb, JsonRbLoot, RbJsonDataService, isEnchantScroll } from '../../services/rb-json-data.service';
import {
  CraftCatalogService,
  CraftCategory,
  CraftEntry,
  buildNameIndex,
  normName,
} from '../../services/craft-catalog.service';
import {
  MercShare,
  NewRaidKill,
  PayoutConfig,
  PayoutTarget,
  RaidDrop,
  RaidKill,
  RaidLootService,
  RaidParticipant,
  RaidSale,
  SalePayout,
} from '../../services/raid-loot.service';
import { GradeBadgeComponent } from '../shared/grade-badge/grade-badge.component';

/** one row of the selected boss's own drop table, checkable + quantity */
interface LootRow {
  key: string;
  loot: JsonRbLoot;
  checked: boolean;
  qty: number;
  catalogId: string | null;
}

interface DropLine {
  key: string;
  kill: RaidKill;
  drop: RaidDrop;
  remaining: number;
}

/** the 5 buckets "Дроп на складе"/"Продажи" filter/group by — narrower than the full
 *  7-value CraftCategory (weapon/armor/jewelry/resource/part/recipe/other) from the
 *  craft catalogue, plus a "scroll" bucket the catalogue has no concept of at all
 *  (enchant scrolls are detected by name, see `isEnchantScroll`, not by category). */
type RaidItemCategory = 'weapon' | 'armor' | 'jewelry' | 'scroll' | 'other';
const RAID_CATEGORY_LABEL: Record<RaidItemCategory, string> = {
  weapon: 'Оружие',
  armor: 'Броня',
  jewelry: 'Бижутерия',
  scroll: 'Заточки',
  other: 'Прочее',
};

interface DropGroup {
  key: string;
  name: string;
  icon: string | null;
  grade: string | null;
  category: RaidItemCategory;
  total: number;
  lines: DropLine[];
}

interface DropCategoryBlock {
  category: RaidItemCategory;
  label: string;
  groups: DropGroup[];
}

interface PlayerRef {
  groupId: string;
  groupName: string;
  userId: string;
  name: string;
}

type PayoutRole = 'bank' | 'leader' | 'merc' | 'mixed';

/** one payout share of one sale, flattened for the "Статистика" tab */
interface PayoutEvent {
  key: string;
  recipientKey: string;
  recipientName: string;
  role: PayoutRole;
  amount: number;
  paid: boolean;
  paidAt: number | null;
  itemName: string;
  bossName: string;
}

interface PersonStat {
  key: string;
  name: string;
  role: PayoutRole;
  paidTotal: number;
  pendingTotal: number;
  count: number;
  lastPaidAt: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function newLocalId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

@Component({
  selector: 'app-raids',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputTextModule,
    TooltipModule,
    GradeBadgeComponent,
    GuidedTourComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './raids.component.html',
  styleUrl: './raids.component.scss',
})
export class RaidsComponent {
  private raidLoot = inject(RaidLootService);
  private constPartyService = inject(ConstPartyService);
  private rbJsonData = inject(RbJsonDataService);
  private craftCatalog = inject(CraftCatalogService);
  private auth = inject(AuthService);
  private onboarding = inject(OnboardingService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private destroyRef = inject(DestroyRef);

  readonly view = signal<'kills' | 'drop' | 'sales' | 'stats'>('kills');

  /* ------------------------------------------------------------------ data */

  readonly kills = toSignal(this.raidLoot.kills$, { initialValue: [] as RaidKill[] });
  readonly sales = toSignal(this.raidLoot.sales$, { initialValue: [] as RaidSale[] });
  readonly config = toSignal(this.raidLoot.config$, { initialValue: null as PayoutConfig | null });
  readonly groups = toSignal(this.constPartyService.getGroups(), { initialValue: [] as ConstPartyGroup[] });
  /** boss catalogue from assets/data/db.json — each entry carries its own drop table */
  readonly bosses = toSignal(this.rbJsonData.getRaidBosses(), { initialValue: [] as JsonRb[] });
  readonly catalog = toSignal(this.craftCatalog.catalog$, { initialValue: [] as CraftEntry[] });
  readonly myEmail = toSignal(this.auth.user$.pipe(map((u) => u?.email ?? '')), { initialValue: '' });

  private readonly catalogNameIndex = computed(() => buildNameIndex(this.catalog()));

  readonly bossOptions = computed(() =>
    [...this.bosses()]
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
      .map((b) => ({ label: `[${b.level}] ${b.name}`, value: b.id })),
  );
  readonly selectedBoss = computed(() => this.bosses().find((b) => b.id === this.killBossId()) ?? null);

  /** every player across every pack, for the mercenary/leader pickers */
  readonly allPlayers = computed<PlayerRef[]>(() =>
    this.groups().flatMap((g) =>
      (g.users ?? []).map((u) => ({ groupId: g.id, groupName: g.displayName, userId: u.id, name: u.name })),
    ),
  );
  readonly leaderOptions = computed(() =>
    this.allPlayers()
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ label: `${p.name} (${p.groupName})`, value: `${p.groupId}:${p.userId}` })),
  );

  trackByGroup = (_: number, g: ConstPartyGroup) => g.id;
  trackByUser = (_: number, u: ConstPartyUser) => u.id;
  trackByKill = (_: number, k: RaidKill) => k.id;
  trackBySale = (_: number, s: RaidSale) => s.id;
  trackByLootRow = (_: number, r: LootRow) => r.key;
  trackByGroupItem = (_: number, g: DropGroup) => g.key;
  trackByLine = (_: number, l: DropLine) => l.key;

  imgError(e: Event): void {
    const el = e.target as HTMLImageElement | null;
    if (el) el.style.visibility = 'hidden';
  }
  fmtDate(ts: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  fmtMoney(n: number): string {
    return new Intl.NumberFormat('ru-RU').format(Math.round(n * 100) / 100);
  }

  /* ============================================================ KILL LOG === */

  /** search across boss name, participant names, drop names, and the kill date */
  readonly killSearch = signal('');
  /** all kills / only ones with drop still unsold / only fully sold-out ones */
  readonly killStatusFilter = signal<'all' | 'open' | 'closed'>('all');

  readonly filteredKills = computed(() => {
    const q = this.killSearch().trim().toLowerCase();
    const status = this.killStatusFilter();
    return this.kills().filter((k) => {
      const soldOut = this.isKillFullySold(k);
      if (status === 'open' && soldOut) return false;
      if (status === 'closed' && !soldOut) return false;
      if (!q) return true;
      const haystack = [
        k.bossName,
        this.fmtDate(k.killedAt),
        ...k.participants.map((p) => p.name),
        ...k.drops.map((d) => d.name),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  });

  /** every drop line from this kill has been completely sold off */
  isKillFullySold(kill: RaidKill): boolean {
    if (!kill.drops.length) return false;
    const sold = this.soldByKey();
    return kill.drops.every((d) => (sold.get(`${kill.id}:${d.id}`) ?? 0) >= d.qty);
  }

  /** how much of this one drop line has already been sold */
  dropSoldQty(kill: RaidKill, drop: RaidDrop): number {
    return Math.min(drop.qty, this.soldByKey().get(`${kill.id}:${drop.id}`) ?? 0);
  }
  /** what's left of this drop line — this is the "остаток" the user wants to see */
  dropRemaining(kill: RaidKill, drop: RaidDrop): number {
    return Math.max(0, drop.qty - this.dropSoldQty(kill, drop));
  }

  readonly killDialogOpen = signal(false);
  readonly savingKill = signal(false);
  /** set while editing an existing kill instead of logging a new one */
  readonly editingKillId = signal<string | null>(null);
  readonly killBossId = signal<string | null>(null);
  readonly killDate = signal<string>('');
  readonly killNote = signal('');
  readonly killPackIds = signal<Set<string>>(new Set());
  /** `${groupId}:${userId}` -> selected */
  readonly killParticipants = signal<Set<string>>(new Set());
  /** the selected boss's own drop table, checkable + quantity */
  readonly killLootRows = signal<LootRow[]>([]);

  private localInputFromDate(d: Date): string {
    d.setSeconds(0, 0);
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 16);
  }
  private nowLocalInput(): string {
    return this.localInputFromDate(new Date());
  }

  openKillDialog(): void {
    this.editingKillId.set(null);
    this.editingOriginalDrops = [];
    this.killBossId.set(null);
    this.killDate.set(this.nowLocalInput());
    this.killNote.set('');
    this.killPackIds.set(new Set());
    this.killParticipants.set(new Set());
    this.killLootRows.set([]);
    this.killDialogOpen.set(true);
  }
  /** original drops of the kill being edited, so unchanged items keep their id (sales
   *  reference `dropId` — regenerating it would orphan any already-sold quantity tracking) */
  private editingOriginalDrops: RaidDrop[] = [];

  /** open the same dialog pre-filled from an existing kill, to fix a mistake */
  openEditKill(kill: RaidKill): void {
    this.editingKillId.set(kill.id);
    this.editingOriginalDrops = kill.drops;
    this.killDate.set(this.localInputFromDate(new Date(kill.killedAt)));
    this.killNote.set(kill.note ?? '');
    this.killPackIds.set(new Set(kill.packIds));
    this.killParticipants.set(new Set(kill.participants.map((p) => `${p.groupId}:${p.userId}`)));
    this.onKillBossChange(kill.bossId);
    const byName = new Map(kill.drops.map((d) => [d.name.trim().toLowerCase(), d]));
    this.killLootRows.update((rows) =>
      rows.map((r) => {
        const existing = byName.get(r.loot.displayName.trim().toLowerCase());
        return existing ? { ...r, checked: true, qty: existing.qty } : r;
      }),
    );
    this.killDialogOpen.set(true);
  }
  closeKillDialog(): void {
    this.killDialogOpen.set(false);
    this.editingKillId.set(null);
    this.editingOriginalDrops = [];
  }

  /** re-populate the loot checklist from the newly picked boss's own drop table */
  onKillBossChange(bossId: string | null): void {
    this.killBossId.set(bossId);
    const boss = this.bosses().find((b) => b.id === bossId);
    const index = this.catalogNameIndex();
    this.killLootRows.set(
      (boss?.loot ?? []).map((loot, i) => {
        const qty = Math.max(1, parseInt(String(loot.qty ?? '1'), 10) || 1);
        return {
          key: `${loot.displayName}-${i}`,
          loot,
          checked: false,
          qty,
          catalogId: index.get(normName(loot.displayName))?.id ?? null,
        };
      }),
    );
  }
  toggleLootRow(key: string): void {
    this.killLootRows.update((rows) =>
      rows.map((r) => (r.key === key ? { ...r, checked: !r.checked } : r)),
    );
  }
  setLootRowQty(key: string, qty: number): void {
    this.killLootRows.update((rows) =>
      rows.map((r) => (r.key === key ? { ...r, qty: Math.max(1, Math.round(qty || 1)) } : r)),
    );
  }
  readonly killLootCheckedCount = computed(
    () => this.killLootRows().filter((r) => r.checked).length,
  );

  toggleKillPack(groupId: string): void {
    const packs = new Set(this.killPackIds());
    if (packs.has(groupId)) {
      packs.delete(groupId);
      // drop that pack's participants too, whatever was picked for them
      const group = this.groups().find((g) => g.id === groupId);
      const parts = new Set(this.killParticipants());
      for (const u of group?.users ?? []) parts.delete(`${groupId}:${u.id}`);
      this.killParticipants.set(parts);
    } else {
      packs.add(groupId);
      // no participants pre-checked — pick who actually showed up
    }
    this.killPackIds.set(packs);
  }
  isKillPackOn(groupId: string): boolean {
    return this.killPackIds().has(groupId);
  }
  toggleKillParticipant(groupId: string, userId: string): void {
    const key = `${groupId}:${userId}`;
    const parts = new Set(this.killParticipants());
    parts.has(key) ? parts.delete(key) : parts.add(key);
    this.killParticipants.set(parts);
  }
  isKillParticipantOn(groupId: string, userId: string): boolean {
    return this.killParticipants().has(`${groupId}:${userId}`);
  }
  /** twinks don't attend as their own participant — only the main roster is pickable */
  mainUsers(g: ConstPartyGroup): ConstPartyUser[] {
    return (g.users ?? []).filter((u) => !u.isTwink);
  }
  selectAllInGroup(g: ConstPartyGroup): void {
    const parts = new Set(this.killParticipants());
    for (const u of this.mainUsers(g)) parts.add(`${g.id}:${u.id}`);
    this.killParticipants.set(parts);
  }
  clearGroupParticipants(g: ConstPartyGroup): void {
    const parts = new Set(this.killParticipants());
    for (const u of this.mainUsers(g)) parts.delete(`${g.id}:${u.id}`);
    this.killParticipants.set(parts);
  }
  groupParticipantCount(g: ConstPartyGroup): number {
    return this.mainUsers(g).filter((u) => this.isKillParticipantOn(g.id, u.id)).length;
  }
  readonly killSelectedGroups = computed(() =>
    this.groups().filter((g) => this.killPackIds().has(g.id)),
  );
  readonly killParticipantCount = computed(() => this.killParticipants().size);

  async submitKill(): Promise<void> {
    if (this.savingKill()) return;
    const boss = this.selectedBoss();
    if (!boss) {
      this.toast('warn', 'Выберите рейд-босса', '');
      return;
    }
    const packs = this.killSelectedGroups();
    if (!packs.length) {
      this.toast('warn', 'Выберите хотя бы один пак', '');
      return;
    }
    const participants: RaidParticipant[] = [];
    for (const g of packs) {
      for (const u of g.users ?? []) {
        if (this.isKillParticipantOn(g.id, u.id)) {
          participants.push({ groupId: g.id, groupName: g.displayName, userId: u.id, name: u.name });
        }
      }
    }
    const originalDropsByName = new Map(
      this.editingOriginalDrops.map((d) => [d.name.trim().toLowerCase(), d]),
    );
    const drops: RaidDrop[] = this.killLootRows()
      .filter((r) => r.checked)
      .map((r) => {
        const original = originalDropsByName.get(r.loot.displayName.trim().toLowerCase());
        return {
          // keep the original drop's id when it's still checked, since sales reference
          // `dropId` — regenerating it here would orphan that item's sold-quantity tracking
          id: original?.id ?? newLocalId(),
          catalogId: r.catalogId,
          name: r.loot.displayName,
          icon: r.loot.imgUrl || null,
          grade: r.loot.grade ?? null,
          qty: Math.max(1, Math.round(r.qty || 1)),
        };
      });

    const killedAt = this.killDate() ? new Date(this.killDate()).getTime() : Date.now();
    const payload: NewRaidKill = {
      bossId: boss.id,
      bossName: boss.name,
      bossIcon: null,
      bossLevel: boss.level ?? null,
      killedAt,
      packIds: packs.map((g) => g.id),
      packNames: packs.map((g) => g.displayName),
      participants,
      drops,
      note: this.killNote().trim(),
    };

    this.savingKill.set(true);
    try {
      const editId = this.editingKillId();
      if (editId) {
        await this.raidLoot.updateKill(editId, payload);
        this.toast('success', 'Убийство обновлено', boss.name);
      } else {
        await this.raidLoot.addKill(payload, this.myEmail());
        this.toast('success', 'Убийство записано', boss.name);
      }
      this.closeKillDialog();
    } catch (e) {
      this.toast('error', 'Ошибка', this.msg(e));
    } finally {
      this.savingKill.set(false);
    }
  }

  /** collapsed by default — expand to see who exactly attended + the drop */
  readonly expandedKillIds = signal<Set<string>>(new Set());
  toggleKillExpanded(id: string): void {
    const next = new Set(this.expandedKillIds());
    next.has(id) ? next.delete(id) : next.add(id);
    this.expandedKillIds.set(next);
  }
  isKillExpanded(id: string): boolean {
    return this.expandedKillIds().has(id);
  }

  /** the configured mercenary roster, by userId — for badging participants below */
  readonly mercRosterIds = computed(() => new Set((this.config()?.mercenaries ?? []).map((m) => m.userId)));
  isMercRosterMember(userId: string): boolean {
    return this.mercRosterIds().has(userId);
  }

  /** this kill's participants, grouped by pack, for the expanded view */
  participantsByPack(
    kill: RaidKill,
  ): { groupId: string; groupName: string; people: { userId: string; name: string }[] }[] {
    const map = new Map<string, { groupId: string; groupName: string; people: { userId: string; name: string }[] }>();
    for (const p of kill.participants) {
      const g = map.get(p.groupId) ?? { groupId: p.groupId, groupName: p.groupName, people: [] };
      g.people.push({ userId: p.userId, name: p.name });
      map.set(p.groupId, g);
    }
    return [...map.values()];
  }

  confirmDeleteKill(kill: RaidKill): void {
    this.confirmationService.confirm({
      header: 'Удалить запись убийства',
      message: `Удалить убийство «${kill.bossName}» от ${this.fmtDate(kill.killedAt)}? Проданный с него дроп из истории продаж не удалится.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Удалить',
      rejectLabel: 'Отмена',
      acceptButtonStyleClass: 'p-button-danger',
      accept: async () => {
        try {
          await this.raidLoot.removeKill(kill.id);
          this.toast('success', 'Удалено', kill.bossName);
        } catch (e) {
          this.toast('error', 'Ошибка', this.msg(e));
        }
      },
    });
  }

  /* ========================================================== AVAIL. DROP === */

  private readonly soldByKey = computed(() => {
    const m = new Map<string, number>();
    for (const s of this.sales()) {
      const key = `${s.killId}:${s.dropId}`;
      m.set(key, (m.get(key) ?? 0) + s.qty);
    }
    return m;
  });

  readonly dropLines = computed<DropLine[]>(() => {
    const sold = this.soldByKey();
    const lines: DropLine[] = [];
    for (const k of this.kills()) {
      for (const d of k.drops) {
        const key = `${k.id}:${d.id}`;
        const remaining = d.qty - (sold.get(key) ?? 0);
        if (remaining > 0) lines.push({ key, kill: k, drop: d, remaining });
      }
    }
    return lines;
  });

  /** the catalogue has 7 categories (weapon/armor/jewelry/resource/part/recipe/other), but
   *  this page only ever offers 5 filter buckets — collapse anything that isn't gear into
   *  'other' so a resource/part/recipe item (a crafting material — "кусок" mats, etc.) is
   *  reachable under "Прочее" instead of silently matching none of the buckets and
   *  disappearing from every specific-category filter (and from the "Все" grouped view).
   *  Enchant scrolls get their own "Заточки" bucket regardless of catalog category, since
   *  the catalogue itself has no concept of "scroll" — detected purely by name. */
  private itemCategory(name: string, catalogCategory: CraftCategory | null | undefined): RaidItemCategory {
    if (isEnchantScroll(name)) return 'scroll';
    if (catalogCategory === 'weapon' || catalogCategory === 'armor' || catalogCategory === 'jewelry') {
      return catalogCategory;
    }
    return 'other';
  }

  /** category of a drop, resolved via a best-effort catalog name match (grade-blind — safe,
   *  since a name collision only ever happens between grades of the same item type, which
   *  always share the same category anyway). Falls back to 'other' when unmatched. */
  private dropCategory(drop: RaidDrop): RaidItemCategory {
    return this.itemCategory(drop.name, this.catalogNameIndex().get(normName(drop.name))?.category);
  }

  private static readonly DROP_CATEGORY_ORDER: RaidItemCategory[] = [
    'weapon',
    'armor',
    'jewelry',
    'scroll',
    'other',
  ];
  private static readonly DROP_CATEGORY_RANK: Partial<Record<RaidItemCategory, number>> = {
    weapon: 0,
    armor: 1,
    jewelry: 2,
    scroll: 3,
  };
  private dropCategoryRank(category: RaidItemCategory): number {
    return RaidsComponent.DROP_CATEGORY_RANK[category] ?? 4;
  }

  readonly dropGroups = computed<DropGroup[]>(() => {
    const byName = new Map<string, DropGroup>();
    for (const line of this.dropLines()) {
      // Group strictly by the drop's own (verbatim) name, never by catalogId: catalogId
      // comes from a normName()-based fuzzy match against the catalog, and normName()
      // strips "(D-Grade)"/"(C-Grade)" as parenthetical noise — so different grades of the
      // same scroll can resolve to the identical catalogId and would otherwise merge.
      const gKey = line.drop.name.trim().toLowerCase();
      const g = byName.get(gKey) ?? {
        key: gKey,
        name: line.drop.name,
        icon: line.drop.icon,
        grade: line.drop.grade,
        category: this.dropCategory(line.drop),
        total: 0,
        lines: [],
      };
      g.total += line.remaining;
      g.lines.push(line);
      byName.set(gKey, g);
    }
    return [...byName.values()]
      .map((g) => ({ ...g, lines: g.lines.sort((a, b) => b.kill.killedAt - a.kill.killedAt) }))
      .sort(
        (a, b) => this.dropCategoryRank(a.category) - this.dropCategoryRank(b.category) ||
          a.name.localeCompare(b.name),
      );
  });

  readonly dropSearch = signal('');
  /** 'all' or one specific category — pick ONE bucket to view, not just a sort order */
  readonly dropCategoryFilter = signal<'all' | RaidItemCategory>('all');
  setDropCategoryFilter(cat: 'all' | RaidItemCategory): void {
    this.dropCategoryFilter.set(cat);
  }
  readonly filteredDropGroups = computed(() => {
    const q = normName(this.dropSearch());
    const cat = this.dropCategoryFilter();
    return this.dropGroups().filter(
      (g) => (cat === 'all' || g.category === cat) && (!q || normName(g.name).includes(q)),
    );
  });

  /** filtered drops split into fixed category sections — Оружие / Броня / Бижутерия / Прочее.
   *  Collapses to a single unlabelled block once a specific category filter is picked. */
  readonly categorizedDropGroups = computed<DropCategoryBlock[]>(() => {
    const groups = this.filteredDropGroups();
    const cat = this.dropCategoryFilter();
    if (cat !== 'all') return [{ category: cat, label: RAID_CATEGORY_LABEL[cat], groups }];
    return RaidsComponent.DROP_CATEGORY_ORDER.map((category) => ({
      category,
      label: RAID_CATEGORY_LABEL[category],
      groups: groups.filter((g) => g.category === category),
    })).filter((block) => block.groups.length > 0);
  });

  readonly openDropGroups = signal<Set<string>>(new Set());
  toggleDropGroup(key: string): void {
    const next = new Set(this.openDropGroups());
    next.has(key) ? next.delete(key) : next.add(key);
    this.openDropGroups.set(next);
  }
  isDropGroupOpen(key: string): boolean {
    return this.openDropGroups().has(key);
  }

  /* ================================================================ SELL === */

  readonly sellLine = signal<DropLine | null>(null);
  readonly sellQty = signal(1);
  /** price of ONE unit — the total sale price (what actually gets saved/split) is
   *  `sellUnitPrice * sellQty`, recomputed automatically whenever either changes */
  readonly sellUnitPrice = signal(0);
  readonly savingSale = signal(false);

  readonly sellTotalPrice = computed(() => round2(this.sellUnitPrice() * this.sellQty()));

  openSell(line: DropLine): void {
    if (!this.config()?.leaderUserId) {
      this.toast('warn', 'Сначала настройте выплаты', 'Укажите лидера, % банка и % наёмников');
      this.openConfig();
      return;
    }
    this.sellLine.set(line);
    this.sellQty.set(1);
    this.sellUnitPrice.set(0);
  }
  closeSell(): void {
    this.sellLine.set(null);
  }

  readonly sellPayoutPreview = computed<SalePayout | null>(() => {
    const line = this.sellLine();
    const cfg = this.config();
    if (!line || !cfg) return null;
    return this.computePayout(this.sellTotalPrice(), line.kill, cfg);
  });

  private computePayout(price: number, kill: RaidKill, cfg: PayoutConfig): SalePayout {
    const bankAmount = round2((price * cfg.bankPercent) / 100);
    // only the designated mercenary roster qualifies — and only if they were
    // actually at THIS kill. Everyone else who attended gets nothing.
    const mercRoster = new Set((cfg.mercenaries ?? []).map((m) => m.userId));
    const mercs = kill.participants.filter(
      (p) => p.userId !== cfg.leaderUserId && mercRoster.has(p.userId),
    );
    const mercAmountEach = round2((price * cfg.mercenaryPercent) / 100);
    const mercenaries: Record<string, MercShare> = {};
    for (const p of mercs) {
      mercenaries[p.userId] = { groupId: p.groupId, name: p.name, amount: mercAmountEach, paid: false, paidAt: null };
    }
    const mercsTotal = mercAmountEach * mercs.length;
    const leaderAmount = round2(price - bankAmount - mercsTotal);
    return {
      bankPercent: cfg.bankPercent,
      bank: { amount: bankAmount, paid: false, paidAt: null },
      leaderId: cfg.leaderUserId,
      leaderName: cfg.leaderName,
      leader: { amount: leaderAmount, paid: false, paidAt: null },
      mercenaryPercent: cfg.mercenaryPercent,
      mercenaries,
    };
  }

  readonly mercPreviewList = computed(() => {
    const p = this.sellPayoutPreview();
    return p ? Object.values(p.mercenaries) : [];
  });

  /** mercenary shares of one sale, as a typed {key, value} array (avoids the
   *  `keyvalue` pipe's generic inference falling back to `unknown` through
   *  the shared #saleRow ng-template's untyped context) */
  mercEntries(s: RaidSale): { key: string; value: MercShare }[] {
    return Object.entries(s.payout.mercenaries).map(([key, value]) => ({ key, value }));
  }

  async submitSell(): Promise<void> {
    if (this.savingSale()) return;
    const line = this.sellLine();
    const cfg = this.config();
    if (!line || !cfg) return;
    const qty = Math.max(1, Math.min(line.remaining, Math.round(this.sellQty() || 1)));
    // 0 is a valid price (giveaways etc.) — such sales just land in their own
    // "Бесплатно" group instead of "в процессе"/"завершённые" (see `isFreeSale`)
    const price = Math.max(0, this.sellTotalPrice());

    const payout = this.computePayout(price, line.kill, cfg);
    this.savingSale.set(true);
    try {
      await this.raidLoot.addSale(
        {
          killId: line.kill.id,
          dropId: line.drop.id,
          bossName: line.kill.bossName,
          itemName: line.drop.name,
          icon: line.drop.icon,
          catalogId: line.drop.catalogId,
          grade: line.drop.grade,
          qty,
          price,
          payout,
        },
        this.myEmail(),
      );
      this.toast('success', 'Продажа записана', `${line.drop.name} × ${qty}`);
      this.closeSell();
    } catch (e) {
      this.toast('error', 'Ошибка', this.msg(e));
    } finally {
      this.savingSale.set(false);
    }
  }

  confirmDeleteSale(sale: RaidSale): void {
    this.confirmationService.confirm({
      header: 'Удалить продажу',
      message: `Удалить запись о продаже «${sale.itemName}» × ${sale.qty}? Проданное количество вернётся в «Дроп на складе».`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Удалить',
      rejectLabel: 'Отмена',
      acceptButtonStyleClass: 'p-button-danger',
      accept: async () => {
        try {
          await this.raidLoot.removeSale(sale.id);
          this.toast('success', 'Удалено', sale.itemName);
        } catch (e) {
          this.toast('error', 'Ошибка', this.msg(e));
        }
      },
    });
  }

  async togglePaid(sale: RaidSale, target: PayoutTarget, paid: boolean): Promise<void> {
    if (sale.locked) return;
    try {
      await this.raidLoot.setSharePaid(sale.id, target, paid);
      // the last unpaid share just got marked paid — freeze it automatically,
      // whether that happened by hand or via "Всем выдано"
      if (paid && this.wouldBeSettledAfter(sale, target, paid)) {
        await this.raidLoot.setSaleLocked(sale.id, true);
      }
    } catch (e) {
      this.toast('error', 'Ошибка', this.msg(e));
    }
  }

  /** predicts whether `sale` would be fully paid off after this one toggle */
  private wouldBeSettledAfter(sale: RaidSale, target: PayoutTarget, paid: boolean): boolean {
    const bankPaid = target.kind === 'bank' ? paid : sale.payout.bank.paid;
    const leaderPaid = target.kind === 'leader' ? paid : sale.payout.leader.paid;
    if (!bankPaid || !leaderPaid) return false;
    for (const [uid, m] of Object.entries(sale.payout.mercenaries)) {
      const p = target.kind === 'merc' && target.userId === uid ? paid : m.paid;
      if (!p) return false;
    }
    return true;
  }

  /** ask before unlocking — it's a finalized sale, don't reopen it by accident */
  confirmUnlockSale(sale: RaidSale): void {
    this.confirmationService.confirm({
      header: 'Редактировать выплаты',
      message: 'Слыш, ишак блять, не можешь с первого раза нормально сделать? Точно хочешь редактировать?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Да, редактировать',
      rejectLabel: 'Отмена',
      accept: () => this.unlockSale(sale),
    });
  }

  /** re-open a finalized sale so its payout buttons can be touched again */
  private async unlockSale(sale: RaidSale): Promise<void> {
    try {
      await this.raidLoot.setSaleLocked(sale.id, false);
    } catch (e) {
      this.toast('error', 'Ошибка', this.msg(e));
    }
  }

  /** cancel editing — freeze the sale back without changing any shares */
  async lockSale(sale: RaidSale): Promise<void> {
    try {
      await this.raidLoot.setSaleLocked(sale.id, true);
    } catch (e) {
      this.toast('error', 'Ошибка', this.msg(e));
    }
  }

  /* --------------------------------------------------- expand/collapse UI --- */

  readonly expandedSaleIds = signal<Set<string>>(new Set());
  toggleSaleExpanded(id: string): void {
    const next = new Set(this.expandedSaleIds());
    next.has(id) ? next.delete(id) : next.add(id);
    this.expandedSaleIds.set(next);
  }
  isSaleExpanded(id: string): boolean {
    return this.expandedSaleIds().has(id);
  }

  /* --------------------------------------------- в процессе / завершённые --- */

  /** every share (bank, leader, every mercenary) of the sale has been paid out */
  isSaleSettled(s: RaidSale): boolean {
    if (!s.payout.bank.paid || !s.payout.leader.paid) return false;
    for (const m of Object.values(s.payout.mercenaries)) if (!m.paid) return false;
    return true;
  }
  /** sold for 0 — nothing to actually pay out, so these never belong in "в процессе"
   *  (nagging to mark a 0 share "выдано" is pointless) or "завершённые"; own group */
  private isFreeSale(s: RaidSale): boolean {
    return s.price === 0;
  }
  readonly freeSales = computed(() => this.sales().filter((s) => this.isFreeSale(s)));
  readonly openSales = computed(() =>
    this.sales().filter((s) => !this.isFreeSale(s) && !this.isSaleSettled(s)),
  );
  readonly closedSales = computed(() =>
    this.sales().filter((s) => !this.isFreeSale(s) && this.isSaleSettled(s)),
  );

  /** kill lookup by id — used for the sale row's "killed at" caption and the
   *  "go to kill" jump button, without re-scanning `kills()` per sale */
  private readonly killsById = computed(() => new Map(this.kills().map((k) => [k.id, k])));
  killedAtForSale(s: RaidSale): number | null {
    return this.killsById().get(s.killId)?.killedAt ?? null;
  }

  /** search across item name, boss name, who sold it, the sale date, and the
   *  date the boss was actually killed (not the same as the sale date) */
  readonly salesSearch = signal('');
  /** same 5-bucket category filter as "Дроп на складе" — 'all' or one specific category */
  readonly salesCategoryFilter = signal<'all' | RaidItemCategory>('all');
  setSalesCategoryFilter(cat: 'all' | RaidItemCategory): void {
    this.salesCategoryFilter.set(cat);
  }
  saleCategory(sale: RaidSale): RaidItemCategory {
    return this.itemCategory(sale.itemName, this.catalogNameIndex().get(normName(sale.itemName))?.category);
  }
  private matchesSaleSearch(s: RaidSale, q: string): boolean {
    const killedAt = this.killedAtForSale(s);
    return [s.itemName, s.bossName, s.soldBy, this.fmtDate(s.soldAt), killedAt ? this.fmtDate(killedAt) : '']
      .join(' ')
      .toLowerCase()
      .includes(q);
  }
  private filterSales(list: RaidSale[]): RaidSale[] {
    const q = this.salesSearch().trim().toLowerCase();
    const cat = this.salesCategoryFilter();
    return list.filter(
      (s) => (cat === 'all' || this.saleCategory(s) === cat) && (!q || this.matchesSaleSearch(s, q)),
    );
  }
  readonly filteredOpenSales = computed(() => this.filterSales(this.openSales()));
  readonly filteredClosedSales = computed(() => this.filterSales(this.closedSales()));
  readonly filteredFreeSales = computed(() => this.filterSales(this.freeSales()));

  /** briefly outlined after `goToKill` jumps to it, so it's obvious which card is
   *  actually the one you were sent to, not just "the one that happens to be centered" */
  readonly highlightedKillId = signal<string | null>(null);
  private highlightTimeout: ReturnType<typeof setTimeout> | null = null;

  /** switch to "Убийства", clear any filters that might be hiding it, expand the
   *  card, scroll it into view, and flash a highlight — jump-to-source for a sale's kill */
  goToKill(sale: RaidSale): void {
    const kill = this.kills().find((k) => k.id === sale.killId);
    if (!kill) {
      this.toast('warn', 'Убийство не найдено', 'Возможно, оно было удалено');
      return;
    }
    this.killSearch.set('');
    this.killStatusFilter.set('all');
    this.view.set('kills');
    if (!this.isKillExpanded(kill.id)) this.toggleKillExpanded(kill.id);

    if (this.highlightTimeout != null) clearTimeout(this.highlightTimeout);
    this.highlightedKillId.set(kill.id);
    this.highlightTimeout = setTimeout(() => this.highlightedKillId.set(null), 4000);

    setTimeout(() => {
      document
        .querySelector(`[data-kill-id="${kill.id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  private aggregateOutstanding(list: RaidSale[]) {
    const bank = { total: 0, unpaid: 0 };
    const leaders = new Map<string, { name: string; total: number; unpaid: number }>();
    const mercs = new Map<string, { name: string; total: number; unpaid: number }>();
    for (const s of list) {
      bank.total += s.payout.bank.amount;
      if (!s.payout.bank.paid) bank.unpaid += s.payout.bank.amount;

      const l = leaders.get(s.payout.leaderId) ?? { name: s.payout.leaderName, total: 0, unpaid: 0 };
      l.total += s.payout.leader.amount;
      if (!s.payout.leader.paid) l.unpaid += s.payout.leader.amount;
      leaders.set(s.payout.leaderId, l);

      for (const [uid, m] of Object.entries(s.payout.mercenaries)) {
        const e = mercs.get(uid) ?? { name: m.name, total: 0, unpaid: 0 };
        e.total += m.amount;
        if (!m.paid) e.unpaid += m.amount;
        mercs.set(uid, e);
      }
    }
    return {
      bank,
      leaders: [...leaders.values()],
      mercs: [...mercs.values()].sort((a, b) => b.unpaid - a.unpaid),
    };
  }

  /** aggregated across every still-open (not fully paid) sale — "в процессе" */
  readonly outstanding = computed(() => this.aggregateOutstanding(this.openSales()));

  readonly totalUnpaid = computed(() => {
    const o = this.outstanding();
    return (
      o.bank.unpaid +
      o.leaders.reduce((s, l) => s + l.unpaid, 0) +
      o.mercs.reduce((s, m) => s + m.unpaid, 0)
    );
  });

  readonly settlingAll = signal(false);

  /** mark every unpaid share of every open sale as paid, in one go */
  confirmSettleAll(): void {
    const open = this.openSales();
    if (!open.length) return;
    this.confirmationService.confirm({
      header: 'Отметить всё выданным',
      message: `Отметить выданными все доли по ${open.length} ${
        open.length === 1 ? 'продаже' : 'продажам'
      } «в процессе» (на сумму ${this.fmtMoney(this.totalUnpaid())})?`,
      icon: 'pi pi-check-double',
      acceptLabel: 'Выдано всем',
      rejectLabel: 'Отмена',
      accept: () => this.settleAllOpen(),
    });
  }

  private async settleAllOpen(): Promise<void> {
    if (this.settlingAll()) return;
    const open = this.openSales();
    const targets: { saleId: string; target: PayoutTarget }[] = [];
    for (const s of open) {
      if (!s.payout.bank.paid) targets.push({ saleId: s.id, target: { kind: 'bank' } });
      if (!s.payout.leader.paid) targets.push({ saleId: s.id, target: { kind: 'leader' } });
      for (const [uid, m] of Object.entries(s.payout.mercenaries)) {
        if (!m.paid) targets.push({ saleId: s.id, target: { kind: 'merc', userId: uid } });
      }
    }
    if (!targets.length) return;
    this.settlingAll.set(true);
    try {
      await Promise.all(targets.map((t) => this.raidLoot.setSharePaid(t.saleId, t.target, true)));
      // finalize every sale this batch just fully paid off — locked until "Редактировать"
      await Promise.all(open.map((s) => this.raidLoot.setSaleLocked(s.id, true)));
      this.toast('success', 'Продажи закрыты', `${open.length} ${open.length === 1 ? 'продажа' : 'продаж'} завершено`);
    } catch (e) {
      this.toast('error', 'Ошибка', this.msg(e));
    } finally {
      this.settlingAll.set(false);
    }
  }

  /* ================================================================ STATS === */

  /** one payout share, flattened out of every sale — the raw material for every stat below */
  private readonly payoutEvents = computed<PayoutEvent[]>(() => {
    const events: PayoutEvent[] = [];
    for (const s of this.sales()) {
      events.push({
        key: `${s.id}:bank`,
        recipientKey: 'bank',
        recipientName: 'Банк',
        role: 'bank',
        amount: s.payout.bank.amount,
        paid: s.payout.bank.paid,
        paidAt: s.payout.bank.paidAt,
        itemName: s.itemName,
        bossName: s.bossName,
      });
      events.push({
        key: `${s.id}:leader`,
        recipientKey: s.payout.leaderId || 'leader',
        recipientName: s.payout.leaderName || 'Лидер',
        role: 'leader',
        amount: s.payout.leader.amount,
        paid: s.payout.leader.paid,
        paidAt: s.payout.leader.paidAt,
        itemName: s.itemName,
        bossName: s.bossName,
      });
      for (const [uid, m] of Object.entries(s.payout.mercenaries)) {
        events.push({
          key: `${s.id}:merc:${uid}`,
          recipientKey: uid,
          recipientName: m.name,
          role: 'merc',
          amount: m.amount,
          paid: m.paid,
          paidAt: m.paidAt,
          itemName: s.itemName,
          bossName: s.bossName,
        });
      }
    }
    return events;
  });

  readonly statsSummary = computed(() => {
    const totalKills = this.kills().length;
    const totalSales = this.sales().length;
    const events = this.payoutEvents();
    const totalPaid = events.filter((e) => e.paid).reduce((sum, e) => sum + e.amount, 0);
    const bankTotal = events
      .filter((e) => e.role === 'bank' && e.paid)
      .reduce((sum, e) => sum + e.amount, 0);
    return { totalKills, totalSales, totalPaid, bankTotal };
  });

  /** who got (or still needs to get) paid, how much, how often, and when last */
  readonly personStats = computed<PersonStat[]>(() => {
    const map = new Map<string, PersonStat & { roles: Set<PayoutRole> }>();
    for (const e of this.payoutEvents()) {
      const cur = map.get(e.recipientKey) ?? {
        key: e.recipientKey,
        name: e.recipientName,
        role: e.role,
        roles: new Set<PayoutRole>(),
        paidTotal: 0,
        pendingTotal: 0,
        count: 0,
        lastPaidAt: null,
      };
      cur.roles.add(e.role);
      cur.count++;
      if (e.paid) {
        cur.paidTotal += e.amount;
        if (e.paidAt && (!cur.lastPaidAt || e.paidAt > cur.lastPaidAt)) cur.lastPaidAt = e.paidAt;
      } else {
        cur.pendingTotal += e.amount;
      }
      map.set(e.recipientKey, cur);
    }
    return [...map.values()]
      .map((p) => ({ ...p, role: p.roles.size > 1 ? ('mixed' as const) : p.role }))
      .sort((a, b) => b.paidTotal + b.pendingTotal - (a.paidTotal + a.pendingTotal));
  });

  /** every payout actually handed out, newest first — "кому сколько и когда" */
  readonly allRecentPayouts = computed(() =>
    this.payoutEvents()
      .filter((e) => e.paid && e.paidAt)
      .sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0)),
  );

  readonly recentPageSize = 10;
  readonly recentPage = signal(0);
  readonly recentPageCount = computed(() =>
    Math.max(1, Math.ceil(this.allRecentPayouts().length / this.recentPageSize)),
  );
  readonly recentSafePage = computed(() =>
    Math.max(0, Math.min(this.recentPage(), this.recentPageCount() - 1)),
  );
  readonly recentPayouts = computed(() => {
    const start = this.recentSafePage() * this.recentPageSize;
    return this.allRecentPayouts().slice(start, start + this.recentPageSize);
  });
  goRecentPage(p: number): void {
    this.recentPage.set(Math.max(0, Math.min(p, this.recentPageCount() - 1)));
  }
  readonly recentRangeStart = computed(() => this.recentSafePage() * this.recentPageSize + 1);
  readonly recentRangeEnd = computed(() =>
    Math.min((this.recentSafePage() + 1) * this.recentPageSize, this.allRecentPayouts().length),
  );

  /** up to 5 page numbers centred on the current one */
  readonly recentPageWindow = computed(() => {
    const total = this.recentPageCount();
    const cur = this.recentSafePage();
    const span = Math.min(5, total);
    let start = Math.max(0, cur - Math.floor(span / 2));
    start = Math.min(start, total - span);
    return Array.from({ length: span }, (_, i) => start + i);
  });

  readonly topItems = computed(() => {
    const map = new Map<
      string,
      { name: string; icon: string | null; grade: string | null; qty: number; revenue: number; count: number }
    >();
    for (const s of this.sales()) {
      const key = s.itemName.trim().toLowerCase();
      const cur = map.get(key) ?? { name: s.itemName, icon: s.icon, grade: s.grade, qty: 0, revenue: 0, count: 0 };
      cur.qty += s.qty;
      cur.revenue += s.price;
      cur.count++;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 12);
  });

  readonly bossStats = computed(() => {
    const map = new Map<string, { name: string; kills: number; sales: number; revenue: number }>();
    for (const k of this.kills()) {
      const cur = map.get(k.bossName) ?? { name: k.bossName, kills: 0, sales: 0, revenue: 0 };
      cur.kills++;
      map.set(k.bossName, cur);
    }
    for (const s of this.sales()) {
      const cur = map.get(s.bossName) ?? { name: s.bossName, kills: 0, sales: 0, revenue: 0 };
      cur.sales++;
      cur.revenue += s.price;
      map.set(s.bossName, cur);
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  });

  roleLabel(role: PayoutRole): string {
    switch (role) {
      case 'bank':
        return 'Банк';
      case 'leader':
        return 'Лидер';
      case 'merc':
        return 'Наёмник';
      default:
        return 'Разное';
    }
  }

  /* =============================================================== CONFIG === */

  readonly configOpen = signal(false);
  readonly savingConfig = signal(false);
  readonly cfgLeaderKey = signal<string | null>(null);
  readonly cfgBankPercent = signal(15);
  readonly cfgMercPercent = signal(10);
  /** `${groupId}:${userId}` roster of players eligible to be paid as a mercenary */
  readonly cfgMercKeys = signal<Set<string>>(new Set());

  /** all packs, for grouping the mercenary-roster picker in the config dialog */
  readonly allGroupsForRoster = computed(() => this.groups());

  openConfig(): void {
    const cfg = this.config();
    this.cfgLeaderKey.set(cfg ? `${cfg.leaderGroupId}:${cfg.leaderUserId}` : null);
    this.cfgBankPercent.set(cfg?.bankPercent ?? 15);
    this.cfgMercPercent.set(cfg?.mercenaryPercent ?? 10);
    this.cfgMercKeys.set(new Set((cfg?.mercenaries ?? []).map((m) => `${m.groupId}:${m.userId}`)));
    this.configOpen.set(true);
  }
  closeConfig(): void {
    this.configOpen.set(false);
  }

  toggleCfgMerc(groupId: string, userId: string): void {
    const key = `${groupId}:${userId}`;
    const next = new Set(this.cfgMercKeys());
    next.has(key) ? next.delete(key) : next.add(key);
    this.cfgMercKeys.set(next);
  }
  isCfgMerc(groupId: string, userId: string): boolean {
    return this.cfgMercKeys().has(`${groupId}:${userId}`);
  }
  readonly cfgMercCount = computed(() => this.cfgMercKeys().size);

  async saveConfig(): Promise<void> {
    if (this.savingConfig()) return;
    const key = this.cfgLeaderKey();
    if (!key) {
      this.toast('warn', 'Выберите лидера', '');
      return;
    }
    const [groupId, userId] = key.split(':');
    const player = this.allPlayers().find((p) => p.groupId === groupId && p.userId === userId);
    if (!player) {
      this.toast('error', 'Игрок не найден', '');
      return;
    }
    const mercenaries = [...this.cfgMercKeys()]
      .map((k) => {
        const [gId, uId] = k.split(':');
        return this.allPlayers().find((p) => p.groupId === gId && p.userId === uId);
      })
      .filter((p): p is PlayerRef => !!p)
      .map((p) => ({ groupId: p.groupId, userId: p.userId, name: p.name }));

    this.savingConfig.set(true);
    try {
      await this.raidLoot.saveConfig(
        {
          leaderGroupId: groupId,
          leaderUserId: userId,
          leaderName: player.name,
          bankPercent: Math.max(0, Math.min(100, Number(this.cfgBankPercent()) || 0)),
          mercenaryPercent: Math.max(0, Math.min(100, Number(this.cfgMercPercent()) || 0)),
          mercenaries,
        },
        this.myEmail(),
      );
      this.toast('success', 'Настройки сохранены', '');
      this.closeConfig();
    } catch (e) {
      this.toast('error', 'Ошибка', this.msg(e));
    } finally {
      this.savingConfig.set(false);
    }
  }

  /* ----------------------------------------------------------------- utils */

  private toast(severity: 'success' | 'error' | 'info' | 'warn', summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail, life: severity === 'error' ? 5000 : 2400 });
  }
  private msg(e: unknown): string {
    return e instanceof Error && e.message ? e.message : 'Что-то пошло не так';
  }

  /* ------------------------------------------------------------- onboarding tour */

  // Unlike the Bookmarks tour (personal, per-browser demo data), this page is shared
  // clan data — the tour never creates or edits anything, it only switches tabs and
  // expands whatever's already there so it has something real to spotlight, falling
  // back to a plain centered card wherever nothing exists yet (a brand-new clan).

  private resetTourFilters(): void {
    this.killSearch.set('');
    this.killStatusFilter.set('all');
    this.dropSearch.set('');
    this.setDropCategoryFilter('all');
    this.salesSearch.set('');
    this.setSalesCategoryFilter('all');
  }
  // Clears any expand/collapse state left over from browsing before the tour started,
  // so "the first kill/group/sale" genuinely means the first one in the DOM — a card
  // the visitor had already expanded earlier could otherwise beat the tour's own pick
  // to the front (querySelector only ever returns the first match).
  private resetTourExpandState(): void {
    this.expandedKillIds.set(new Set());
    this.openDropGroups.set(new Set());
    this.expandedSaleIds.set(new Set());
  }
  private ensureFirstKillExpanded(): void {
    const first = this.kills()[0];
    if (first && !this.isKillExpanded(first.id)) this.toggleKillExpanded(first.id);
  }
  private ensureFirstDropGroupExpanded(): void {
    const first = this.dropGroups()[0];
    if (first && !this.isDropGroupOpen(first.key)) this.toggleDropGroup(first.key);
  }
  private ensureFirstSaleExpanded(): void {
    const first = this.openSales()[0] ?? this.closedSales()[0];
    if (first && !this.isSaleExpanded(first.id)) this.toggleSaleExpanded(first.id);
  }

  readonly tourSteps: TourStep[] = [
    {
      title: 'Добро пожаловать на страницу рейд-боссов!',
      paragraphs: [
        'Здесь отмечаем убийства рейд-боссов, ведем учёт дропа на складе, продажи и прочие рассчеты.',
      ],
      onEnter: () => {
        this.resetTourFilters();
        this.resetTourExpandState();
        this.view.set('kills');
      },
    },
    {
      title: 'Четыре вкладки',
      paragraphs: ['Вверху страницы четыре вкладки — переключаются кликом:'],
      bullets: [
        { icon: 'pi-flag-fill', text: 'Убийства — журнал того, кого убили и что упало' },
        { icon: 'pi-box', text: 'Дроп на складе — весь непроданный дроп, сгруппированный по предметам' },
        { icon: 'pi-wallet', text: 'Продажи — что продали, кому сколько причитается, что уже выдано' },
        { icon: 'pi-chart-bar', text: 'Статистика — сводки по людям, предметам, боссам и последним выплатам' },
      ],
      target: '.rd-seg',
    },
    {
      title: 'Настройка выплат',
      paragraphs: [
        'Прежде чем что-то продавать, нужно один раз настроить, как делятся деньги — кнопка «Выплаты» в правом верхнем углу.',
      ],
      bullets: [
        { text: 'Лидер — получает весь остаток от каждой продажи' },
        { text: 'Банк, % — фиксированный процент, который забирает клановый банк' },
        {
          text:
            'Наёмник, % — процент каждому из списка наёмников, но только если он был именно на том ' +
            'убийстве, с которого продан дроп',
        },
      ],
      target: '[data-tour="rd-tour-payout-btn"]',
    },
    {
      title: 'Вкладка «Убийства» — панель инструментов',
      paragraphs: [
        'Поиск ищет сразу по названию босса, участнику, предмету и дате.',
        'Три фильтра справа: «Все», «Есть дроп» (что-то ещё не продано) и «Распродано» (весь дроп с этого убийства уже продан).',
        'Кнопка «Добавить РБ» открывает форму отметки нового убийства.',
      ],
      onEnter: () => {
        this.resetTourFilters();
        this.view.set('kills');
      },
      target: '.rd-toolbar',
    },
    {
      title: 'Карточка убийства',
      paragraphs: [
        'Каждая строка — одно убийство. По умолчанию она свёрнута — виден только босс, уровень, дата и значок статуса:',
      ],
      bullets: [
        { icon: 'pi-flag-fill', iconBg: '#eef2ff', iconColor: '#4f46e5', text: 'ещё есть непроданный дроп' },
        { icon: 'pi-check', iconBg: '#dcfce7', iconColor: '#16a34a', text: '«Распродано» — весь дроп уже продан' },
        { icon: 'pi-pencil', text: 'редактировать убийство — босса, дату, участников, дроп' },
        { icon: 'pi-trash', text: 'удалить запись целиком (история продаж при этом не пропадает)' },
      ],
      onEnter: () => this.view.set('kills'),
      target: '.rd-kill-head',
    },
    {
      title: 'Развёрнутая карточка убийства',
      paragraphs: [
        'Клик по строке разворачивает её: видно участников по пакам и весь дроп, отмеченный с этого убийства.',
        'Янтарная подсветка имени — это наёмник (из ростера в настройках выплат); у остальных участников просто нет права на долю.',
        'На чипе дропа появляется «остаток N» или «продано», как только часть или весь предмет уже продан.',
      ],
      onEnter: () => {
        this.view.set('kills');
        this.ensureFirstKillExpanded();
      },
      target: '.rd-kill-body',
    },
    {
      title: 'Форма «Добавить РБ»',
      paragraphs: ['Открывается кнопкой «Добавить РБ» или карандашом на существующей записи. В форме:'],
      bullets: [
        { text: 'Рейд-босс — выпадающий список, отсортированный по уровню, с поиском' },
        { text: 'Дата и время — когда именно убили' },
        { text: 'Паки, которые были — отметьте все паки, участвовавшие в убийстве' },
        {
          text:
            'Участники — по каждому паку отдельно выберите, кто реально был (твинки в этом списке не ' +
            'показываются — им доля не положена)',
        },
        {
          text:
            'Дроп — настоящая таблица дропа именно этого босса из базы, с чекбоксами и количеством на ' +
            'каждый предмет',
        },
      ],
    },
    {
      title: 'Вкладка «Дроп на складе» — панель инструментов',
      paragraphs: [
        'Тут собран весь дроп, который ещё не продан, сгруппированный по предмету — даже если он падал с разных боссов.',
        'Фильтр по категории показывает только оружие, только броню, только бижутерию, только заточки или всё остальное прочее — либо «Все» сразу.',
        'Поиск ищет по названию предмета.',
      ],
      onEnter: () => {
        this.resetTourFilters();
        this.view.set('drop');
      },
      target: '.rd-toolbar',
    },
    {
      title: 'Группа дропа',
      paragraphs: [
        'Заголовок — иконка, название, грейд и общее количество на складе.',
        'Разверните группу — и увидите, с какого именно убийства и когда этот дроп пришёл, сколько осталось, и кнопку «Продать» на каждую строку.',
      ],
      onEnter: () => {
        this.view.set('drop');
        this.ensureFirstDropGroupExpanded();
      },
      target: '.rd-drop-group',
    },
    {
      title: 'Продажа дропа',
      paragraphs: ['Кнопка «Продать» на конкретной строке дропа открывает диалог продажи:'],
      bullets: [
        { text: 'Количество — не больше, чем реально осталось от этого убийства' },
        { text: 'Цена — за одну штуку; итоговая сумма считается сама (цена × количество)' },
        { text: 'Ниже сразу показывается предпросмотр — сколько получит банк, лидер и каждый наёмник при такой цене' },
      ],
    },
    {
      title: 'Вкладка «Продажи» — панель инструментов',
      paragraphs: [
        'Тот же фильтр по категории, что и в «Дропе на складе».',
        'Поиск ищет по предмету, боссу, продавцу, дате продажи и дате убийства босса.',
      ],
      onEnter: () => {
        this.resetTourFilters();
        this.view.set('sales');
      },
      target: '.rd-toolbar',
    },
    {
      title: 'Панель «В процессе»',
      paragraphs: [
        'Показывает суммарно, сколько ещё не выдано — отдельно банку, лидеру и каждому наёмнику, по всем незавершённым продажам сразу.',
        'Кнопка «Всем выдано» разом отмечает все доли всех открытых продаж как выданные.',
      ],
      onEnter: () => this.view.set('sales'),
      target: '.rd-outstanding',
    },
    {
      title: '«В процессе», «Завершённые» и «Бесплатно»',
      paragraphs: [
        'Каждая продажа — своя строка: предмет, количество, босс (мелким шрифтом под ним — когда именно убили этого босса), цена, дата. Клик разворачивает её.',
        'Пока не выдана хотя бы одна доля — продажа лежит в «В процессе». Как только выданы все доли — она сама переезжает в «Завершённые».',
        'Если продали за 0 адены (например, отдали бесплатно) — такая продажа попадает в отдельную группу «Бесплатно»: делить там нечего, поэтому она не путается под ногами в «В процессе».',
      ],
      bullets: [{ icon: 'pi-flag-fill', text: 'кнопка справа переносит на убийство, с которого продан этот предмет' }],
      onEnter: () => this.view.set('sales'),
      target: '.rd-sale-head',
    },
    {
      title: 'Доли и фиксация продажи',
      paragraphs: [
        'В развёрнутой продаже — три вида долей: банк, лидер (остаток) и каждый наёмник с этого убийства. Кнопка переключает «Выдано» / «Не выдано» по каждой доле отдельно.',
        'Как только выданы все доли, продажа автоматически «фиксируется» — кнопки блокируются, чтобы случайно не поменять уже закрытую продажу.',
        'Разблокировать можно кнопкой «Редактировать» (спросит подтверждение), а передумать и снова закрыть без правок — кнопкой «Отмена».',
      ],
      onEnter: () => {
        this.view.set('sales');
        this.ensureFirstSaleExpanded();
      },
      target: '.rd-payout',
    },
    {
      title: 'Вкладка «Статистика» — карточки',
      paragraphs: ['Сверху четыре цифры: сколько всего боссов убито, сколько продаж, сколько всего заработали и сколько получил банк.'],
      onEnter: () => this.view.set('stats'),
      target: '.rd-stat-tiles',
    },
    {
      title: 'Таблица «По людям»',
      paragraphs: ['По каждому получателю (банк, лидер, каждый наёмник) — сколько уже выдано, сколько ещё ожидает, число выплат и дата последней.'],
      onEnter: () => this.view.set('stats'),
      target: '.rd-stat-table--people',
    },
    {
      title: 'Топ дропа по выручке',
      paragraphs: ['Какие предметы принесли больше всего денег — сколько штук продано и на какую сумму, по убыванию выручки.'],
      onEnter: () => this.view.set('stats'),
      target: '.rd-stat-table--items',
    },
    {
      title: 'Статистика по боссам',
      paragraphs: ['То же самое, но по каждому боссу: сколько раз убит и сколько принёс выручки.'],
      onEnter: () => this.view.set('stats'),
      target: '.rd-stat-table--bosses',
    },
    {
      title: 'Последние выплаты',
      paragraphs: [
        'Внизу — лента фактически выданных выплат: кому, какая роль, сколько, за какой предмет с какого босса и когда.',
        'Если выплат много — появляется постраничная навигация, по 10 штук на страницу.',
      ],
      onEnter: () => this.view.set('stats'),
      target: '.rd-stat-table--payouts',
    },
    {
      title: 'Готово!',
      paragraphs: [
        'Теперь вы знаете всё: как отмечать убийства, что происходит с дропом, как проходит продажа и раздел денег, и где смотреть статистику.',
        'Попробуй блять только с тупыми вопросами прийти!',
      ],
    },
  ];

  readonly tourActive = signal(false);
  private readonly pendingTourUid = signal<string | null>(null);

  onTourFinished(result: { skipped: boolean }): void {
    this.tourActive.set(false);
    const uid = this.pendingTourUid();
    this.pendingTourUid.set(null);
    if (uid) void this.onboarding.markTourDone(uid, 'raids', result.skipped);
  }

  constructor() {
    this.auth.user$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((user) => {
      const uid = user?.uid ?? null;
      if (!uid) return;
      this.onboarding.hasCompletedTour(uid, 'raids').then((done) => {
        if (!done) this.pendingTourUid.set(uid);
      });
    });

    // Unlike Bookmarks, this tour shows for any not-yet-completed account regardless
    // of existing data — it's explanatory, not gated on "brand new" data.
    effect(() => {
      if (this.tourActive() || !this.pendingTourUid()) return;
      this.tourActive.set(true);
    });
  }
}
