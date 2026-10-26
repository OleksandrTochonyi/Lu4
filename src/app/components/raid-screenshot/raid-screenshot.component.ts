import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { map } from 'rxjs/operators';

import { AuthService } from '../../services/auth.service';
import { ConstPartyGroup, ConstPartyService, ConstPartyUser } from '../../services/const-party.service';
import { CraftCatalogService, CraftEntry, buildNameIndex, normName } from '../../services/craft-catalog.service';
import { DropDest, NewRaidKill, RaidDrop, RaidLootService, RaidParticipant } from '../../services/raid-loot.service';
import { JsonRb, RbJsonDataService } from '../../services/rb-json-data.service';
import { RbJsonRespService } from '../../services/rb-json-resp.service';
import { GradeBadgeComponent } from '../shared/grade-badge/grade-badge.component';
import {
  BossRef,
  CcResult,
  DEFAULT_REGIONS,
  DropResult,
  PartyResult,
  Region,
  RegionKey,
  Regions,
  RosterPlayer,
  fold,
  ocr,
  parseCc,
  parseDrop,
  parseParty,
  prepareRegion,
  setOcrProgress,
} from './raid-ocr';

const LS_REGIONS = 'raid-shot-regions';

interface DropRow {
  key: string;
  name: string;
  qty: number;
  dest: DropDest;
}

function readRegions(): Regions {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_REGIONS) ?? 'null');
    const ok = (r: any): r is Region => r && [r.x, r.y, r.w, r.h].every((v) => Number.isFinite(v));
    if (raw && ok(raw.party) && ok(raw.cc) && ok(raw.drop)) return raw as Regions;
  } catch {
    /* defaults */
  }
  return structuredClone(DEFAULT_REGIONS);
}

let rowSeq = 0;
const rowKey = () => `r${++rowSeq}`;

/**
 * «Рейд по скрину»: paste a screenshot taken right after a raid boss kill → OCR
 * finds the boss, the drop and the packs → the usual kill form, pre-filled.
 * Nothing is saved until «Сохранить».
 */
@Component({
  selector: 'app-raid-screenshot',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputTextModule,
    ToggleSwitchModule,
    TooltipModule,
    GradeBadgeComponent,
  ],
  templateUrl: './raid-screenshot.component.html',
  styleUrl: './raid-screenshot.component.scss',
})
export class RaidScreenshotComponent {
  private router = inject(Router);
  private messages = inject(MessageService);
  private raidLoot = inject(RaidLootService);
  private rbJsonResp = inject(RbJsonRespService);
  private auth = inject(AuthService);

  readonly groups = toSignal(inject(ConstPartyService).getGroups(), { initialValue: [] as ConstPartyGroup[] });
  readonly bosses = toSignal(inject(RbJsonDataService).getRaidBosses(), { initialValue: [] as JsonRb[] });
  readonly catalog = toSignal(inject(CraftCatalogService).catalog$, { initialValue: [] as CraftEntry[] });
  private readonly myEmail = toSignal(this.auth.user$.pipe(map((u) => u?.email ?? '')), { initialValue: '' });
  private readonly catalogIndex = computed(() => buildNameIndex(this.catalog()));

  /** КП players, for nick matching */
  readonly roster = computed<RosterPlayer[]>(() =>
    this.groups().flatMap((g) =>
      (g.users ?? []).map((u) => ({
        groupId: g.id,
        groupName: g.displayName,
        userId: u.id,
        name: u.name,
        isPL: !!u.isPL,
        isTwink: !!u.isTwink,
      })),
    ),
  );
  private readonly bossRefs = computed<BossRef[]>(() =>
    this.bosses().map((b) => ({ id: String(b.id), name: b.name, loot: b.loot ?? [] })),
  );
  readonly bossOptions = computed(() =>
    [...this.bosses()]
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
      .map((b) => ({ label: `[${b.level}] ${b.name}`, value: String(b.id) })),
  );

  // ---------------------------------------------------------------- image
  readonly imageUrl = signal<string | null>(null);
  private image: HTMLImageElement | null = null;
  readonly imageTakenAt = signal(0);

  @HostListener('window:paste', ['$event'])
  onPaste(e: ClipboardEvent): void {
    const file = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
    if (!file) return;
    e.preventDefault();
    void this.loadFile(file, Date.now());
  }
  onDrop(e: DragEvent): void {
    e.preventDefault();
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) void this.loadFile(file, file.lastModified || Date.now());
  }
  onPick(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.loadFile(file, file.lastModified || Date.now());
    input.value = '';
  }

  private async loadFile(file: File, takenAt: number): Promise<void> {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      this.image = img;
      const prev = this.imageUrl();
      if (prev) URL.revokeObjectURL(prev);
      this.imageUrl.set(url);
      this.imageTakenAt.set(takenAt);
      void this.recognize();
    };
    img.onerror = () => this.toast('error', 'Не удалось открыть картинку', file.name);
    img.src = url;
  }

  // ---------------------------------------------------------------- regions
  readonly regions = signal<Regions>(readRegions());
  readonly regionKeys: RegionKey[] = ['party', 'cc', 'drop'];
  readonly regionLabel: Record<RegionKey, string> = { party: 'Пати', cc: 'Command Channel', drop: 'Дроп (чат)' };
  /** region being redrawn */
  readonly drawing = signal<RegionKey | null>(null);
  readonly draft = signal<Region | null>(null);
  private drawStart: { x: number; y: number } | null = null;

  private saveRegions(): void {
    try {
      localStorage.setItem(LS_REGIONS, JSON.stringify(this.regions()));
    } catch {
      /* ignore */
    }
  }
  startRedraw(k: RegionKey): void {
    this.drawing.set(this.drawing() === k ? null : k);
    this.draft.set(null);
  }
  resetRegions(): void {
    this.regions.set(structuredClone(DEFAULT_REGIONS));
    this.saveRegions();
    if (this.image) void this.recognize();
  }
  private frac(e: MouseEvent): { x: number; y: number } {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }
  onDown(e: MouseEvent): void {
    if (!this.drawing()) return;
    e.preventDefault();
    this.drawStart = this.frac(e);
    this.draft.set({ ...this.drawStart, w: 0, h: 0 });
  }
  onMove(e: MouseEvent): void {
    if (!this.drawStart) return;
    const p = this.frac(e);
    const s = this.drawStart;
    this.draft.set({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  }
  onUp(): void {
    const k = this.drawing();
    const d = this.draft();
    this.drawStart = null;
    if (!k || !d) return;
    if (d.w > 0.01 && d.h > 0.01) {
      this.regions.update((all) => ({ ...all, [k]: d }));
      this.saveRegions();
      this.drawing.set(null);
      this.draft.set(null);
      if (this.image) void this.recognize();
    } else {
      this.draft.set(null);
    }
  }
  pct(v: number): string {
    return `${(v * 100).toFixed(3)}%`;
  }

  // ---------------------------------------------------------------- recognition
  readonly busy = signal(false);
  readonly progress = signal('');
  readonly progressPct = signal(0);
  readonly party = signal<PartyResult | null>(null);
  readonly cc = signal<CcResult | null>(null);
  readonly drop = signal<DropResult | null>(null);

  async recognize(): Promise<void> {
    const img = this.image;
    if (!img || this.busy()) return;
    this.busy.set(true);
    setOcrProgress((stage, pct) => {
      const ru: Record<string, string> = {
        'loading tesseract core': 'загрузка движка',
        'initializing tesseract': 'запуск движка',
        'loading language traineddata': 'скачивание модели (первый раз долго)',
        'initializing api': 'подготовка',
        'recognizing text': 'распознавание',
      };
      this.progress.set(ru[stage] ?? stage);
      this.progressPct.set(pct);
    });
    try {
      const regions = this.regions();
      const read = async (k: RegionKey, label: string) => {
        this.progress.set(label);
        return ocr(prepareRegion(img, regions[k]));
      };
      const partyText = await read('party', 'пати');
      const ccText = await read('cc', 'command channel');
      const dropText = await read('drop', 'дроп');
      const party = parseParty(partyText, this.roster());
      this.party.set(party);
      this.cc.set(parseCc(ccText, this.roster(), party.groupId));
      this.drop.set(parseDrop(dropText, this.bossRefs()));
      this.fillForm();
    } catch (e) {
      this.toast('error', 'Не удалось распознать', e instanceof Error ? e.message : String(e));
    } finally {
      setOcrProgress(null);
      this.busy.set(false);
      this.progress.set('');
    }
  }

  // ---------------------------------------------------------------- summary helpers
  rosterSize(groupId: string): number {
    return this.mainUsers(this.groups().find((g) => g.id === groupId)).length;
  }
  mainUsers(g: ConstPartyGroup | undefined): ConstPartyUser[] {
    return (g?.users ?? []).filter((u) => !u.isTwink);
  }

  // ---------------------------------------------------------------- form
  readonly bossId = signal<string | null>(null);
  readonly killDate = signal('');
  readonly markAsDead = signal(true);
  readonly withFeels = signal(false);
  readonly withClan = signal(false);
  /** off by default: add fast from screenshots, check the drop later */
  readonly dropChecked = signal(false);
  readonly note = signal('');
  readonly packIds = signal<Set<string>>(new Set());
  /** `${groupId}:${userId}` */
  readonly participants = signal<Set<string>>(new Set());
  readonly dropRows = signal<DropRow[]>([]);
  readonly saving = signal(false);

  readonly selectedBoss = computed(() => this.bosses().find((b) => String(b.id) === this.bossId()) ?? null);
  readonly shared = computed(() => this.withClan() || this.withFeels());
  readonly selectedGroups = computed(() => this.groups().filter((g) => this.packIds().has(g.id)));
  /** folded names of the picked boss's drop table */
  private readonly ownLootKeys = computed(() => new Set((this.selectedBoss()?.loot ?? []).map((l) => fold(l.displayName))));

  /** item picker: this boss's drop → names not in it (custom) → every other known item */
  readonly itemGroups = computed(() => {
    type Opt = { label: string; value: string; icon: string | null; grade: string | null };
    const boss = this.selectedBoss();
    const own: Opt[] = (boss?.loot ?? []).map((l) => ({ label: l.displayName, value: l.displayName, icon: l.imgUrl || null, grade: l.grade ?? null }));
    const seen = new Set(own.map((o) => fold(o.value)));
    const custom: Opt[] = [];
    for (const r of this.dropRows()) {
      const f = fold(r.name);
      if (!f || seen.has(f)) continue;
      seen.add(f);
      custom.push({ label: r.name, value: r.name, icon: null, grade: null });
    }
    const others: Opt[] = [];
    const push = (name: string, icon: string | null, grade: string | null) => {
      const f = fold(name);
      if (!f || seen.has(f)) return;
      seen.add(f);
      others.push({ label: name, value: name, icon, grade });
    };
    for (const b of this.bosses()) for (const l of b.loot ?? []) push(l.displayName, l.imgUrl || null, l.grade ?? null);
    for (const e of this.catalog()) push(e.name, e.icon ?? null, e.grade ?? null);
    others.sort((a, b) => a.label.localeCompare(b.label));
    return [
      { label: boss ? `Дроп: ${boss.name}` : 'Дроп РБ — сначала выбери босса', items: own },
      { label: 'Своё (нет в дропе этого РБ)', items: custom },
      { label: 'Все остальные предметы', items: others },
    ].filter((g) => g.items.length);
  });

  /** what's typed in the item picker's search — for «добавить своим названием» */
  readonly itemFilter = signal('');
  setCustom(key: string, dd: { hide: () => void }): void {
    const name = this.itemFilter().trim();
    if (!name) return;
    this.patchRow(key, { name });
    this.itemFilter.set('');
    dd.hide();
  }

  private localInput(ms: number): string {
    const d = new Date(ms);
    d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  /** recognition → form (everything stays editable) */
  private fillForm(): void {
    const party = this.party();
    const cc = this.cc();
    const drop = this.drop();
    this.bossId.set(drop?.boss ? drop.boss.id : this.bossId());
    this.killDate.set(this.localInput(this.imageTakenAt() || Date.now()));
    const packs = new Set<string>();
    const parts = new Set<string>();
    if (party?.groupId) {
      packs.add(party.groupId);
      for (const p of party.players) parts.add(`${p.groupId}:${p.userId}`);
    }
    for (const p of cc?.packs ?? []) {
      packs.add(p.groupId);
      // a CC pack → its whole active core; untick whoever wasn't there
      for (const u of this.mainUsers(this.groups().find((g) => g.id === p.groupId))) parts.add(`${p.groupId}:${u.id}`);
    }
    this.packIds.set(packs);
    this.participants.set(parts);
    // anyone besides our pack in the Command Channel → farmed with others («С кланом»)
    this.withClan.set(!!cc && (cc.packs.length > 0 || cc.foreign.length > 0));
    const dest: DropDest = this.shared() ? 'none' : 'pack';
    this.dropRows.set((drop?.items ?? []).map((i) => ({ key: rowKey(), name: i.name, qty: i.qty, dest })));
  }

  togglePack(id: string): void {
    const packs = new Set(this.packIds());
    if (packs.has(id)) {
      packs.delete(id);
      const parts = new Set(this.participants());
      for (const k of [...parts]) if (k.startsWith(id + ':')) parts.delete(k);
      this.participants.set(parts);
    } else {
      packs.add(id);
    }
    this.packIds.set(packs);
    // any pack besides ours (PH) → farmed with a clan
    const ours = this.ourPackId();
    this.setShared('clan', [...packs].some((p) => p !== ours));
  }

  /** our pack: PH by name, else the one the party window matched */
  private ourPackId(): string | null {
    return this.groups().find((g) => (g.displayName ?? '').trim().toLowerCase() === 'ph')?.id ?? this.party()?.groupId ?? null;
  }
  toggleUser(g: ConstPartyGroup, u: ConstPartyUser): void {
    const k = `${g.id}:${u.id}`;
    const next = new Set(this.participants());
    next.has(k) ? next.delete(k) : next.add(k);
    this.participants.set(next);
  }
  isUserOn(g: ConstPartyGroup, u: ConstPartyUser): boolean {
    return this.participants().has(`${g.id}:${u.id}`);
  }
  groupCount(g: ConstPartyGroup): number {
    return this.mainUsers(g).filter((u) => this.isUserOn(g, u)).length;
  }
  setAllInGroup(g: ConstPartyGroup, on: boolean): void {
    const next = new Set(this.participants());
    for (const u of this.mainUsers(g)) (on ? next.add.bind(next) : next.delete.bind(next))(`${g.id}:${u.id}`);
    this.participants.set(next);
  }

  setShared(kind: 'feels' | 'clan', on: boolean): void {
    const was = this.shared();
    (kind === 'feels' ? this.withFeels : this.withClan).set(on);
    if (was !== this.shared()) {
      const dest: DropDest = this.shared() ? 'none' : 'pack';
      this.dropRows.update((rows) => rows.map((r) => ({ ...r, dest })));
    }
  }

  /** «Добавить предмет» → the picker; the row appears once something is picked */
  addRow(): void {
    this.openPicker(null);
  }
  removeRow(key: string): void {
    this.dropRows.update((rows) => rows.filter((r) => r.key !== key));
  }
  patchRow(key: string, patch: Partial<DropRow>): void {
    this.dropRows.update((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  /** a row's item isn't in the picked boss's drop */
  rowUnknown(r: DropRow): boolean {
    const f = fold(r.name);
    return !!f && !this.ownLootKeys().has(f);
  }

/* ---------------------------------------------------------------- item picker (modal) */

  readonly pickerOpen = signal(false);
  /** the row being changed; null = «Добавить предмет» (a new row on pick) */
  readonly pickerRowKey = signal<string | null>(null);
  readonly pickerQuery = signal('');

  openPicker(rowKey: string | null): void {
    this.pickerRowKey.set(rowKey);
    this.pickerQuery.set('');
    this.pickerOpen.set(true);
  }
  closePicker(): void {
    this.pickerOpen.set(false);
  }

  isPickerCurrent(name: string): boolean {
    return !!this.pickerCurrent() && fold(name) === this.pickerCurrent();
  }

  /** the row's current item, highlighted in the picker */
  readonly pickerCurrent = computed(() => {
    const key = this.pickerRowKey();
    return key ? fold(this.dropRows().find((r) => r.key === key)?.name ?? '') : '';
  });

  private matchesQuery(label: string): boolean {
    const q = fold(this.pickerQuery());
    return !q || fold(label).includes(q);
  }
  /** this boss's drop, filtered — shown as tiles */
  readonly pickerOwn = computed(() => {
    const own = this.itemGroups().find((g) => g.label.startsWith('Дроп:'))?.items ?? [];
    return own.filter((o) => this.matchesQuery(o.label));
  });
  /** names not in the drop + everything else, filtered; capped so the list stays quick */
  readonly pickerRest = computed(() => {
    const rest = this.itemGroups()
      .filter((g) => !g.label.startsWith('Дроп'))
      .flatMap((g) => g.items.map((o) => ({ ...o, custom: g.label.startsWith('Своё') })));
    const hits = rest.filter((o) => this.matchesQuery(o.label));
    return { items: hits.slice(0, this.pickerQuery().trim() ? 120 : 60), total: hits.length };
  });
  /** typed name isn't an existing item → offer it as a custom one */
  readonly pickerCanAddCustom = computed(() => {
    const q = this.pickerQuery().trim();
    if (!q) return false;
    const f = fold(q);
    return !this.itemGroups().some((g) => g.items.some((o) => fold(o.value) === f));
  });

  /** the picture for an option: its own, else found by file name */
  optIcon(o: { icon: string | null; value: string }): string | null {
    return o.icon || this.iconBySlug(o.value);
  }

  pick(name: string): void {
    const clean = name.trim();
    if (!clean) return;
    const key = this.pickerRowKey();
    if (key) this.patchRow(key, { name: clean });
    else this.dropRows.update((rows) => [...rows, { key: rowKey(), name: clean, qty: 1, dest: this.shared() ? 'none' : 'pack' }]);
    this.pickerOpen.set(false);
  }
  /** Enter in the search: the single / first hit, or the typed name */
  pickFirst(): void {
    const first = this.pickerOwn()[0] ?? this.pickerRest().items[0];
    if (first) this.pick(first.value);
    else if (this.pickerCanAddCustom()) this.pick(this.pickerQuery());
  }

  /** icon of the item picked in a drop row */
  rowIcon(r: DropRow): string | null {
    if (!r.name.trim()) return null;
    // drop tables first; many entries there have no picture → the item catalogue
    return (
      this.lootOf(r.name)?.imgUrl ||
      this.catalogIndex().get(normName(r.name))?.icon ||
      this.iconByFold().get(fold(r.name)) ||
      this.iconBySlug(r.name)
    );
  }

  /** assets/item-icons file names (list made by hand: public/assets/item-icons/index.json) */
  private readonly iconFiles = signal<Set<string>>(new Set());
  private readonly loadIconIndex = fetch('assets/item-icons/index.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => this.iconFiles.set(new Set((Array.isArray(list) ? list : []).map((x: unknown) => String(x)))))
    .catch(() => null);

  /** «Demon's Dagger» → demon-dagger.webp / demons-dagger.webp; «Recipe: X (60%)» → recipe-x.webp */
  iconBySlug(name: string): string | null {
    const files = this.iconFiles();
    if (!files.size) return null;
    const base = name
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[:]/g, ' ');
    const slug = (s: string) => s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const candidates = [slug(base.replace(/'s\b/g, 's')), slug(base.replace(/'s\b/g, '')), slug(base.replace(/'/g, ''))];
    for (const c of candidates) {
      for (const ext of ['webp', 'png', 'jpg']) {
        if (files.has(`${c}.${ext}`)) return `assets/item-icons/${c}.${ext}`;
      }
    }
    return null;
  }
  /** every known picture by folded item name (drop tables + catalogue) */
  private readonly iconByFold = computed(() => {
    const m = new Map<string, string>();
    for (const b of this.bosses()) for (const l of b.loot ?? []) if (l.imgUrl && !m.has(fold(l.displayName))) m.set(fold(l.displayName), l.imgUrl);
    for (const e of this.catalog()) if (e.icon && !m.has(fold(e.name))) m.set(fold(e.name), e.icon);
    return m;
  });

  /** the drop table entry for a name (icon / grade) */
  private lootOf(name: string): { imgUrl?: string; grade?: string } | null {
    const f = fold(name);
    const own = this.selectedBoss()?.loot ?? [];
    return own.find((l) => fold(l.displayName) === f) ?? this.bosses().flatMap((b) => b.loot ?? []).find((l) => fold(l.displayName) === f) ?? null;
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    const boss = this.selectedBoss();
    if (!boss) {
      this.toast('warn', 'Выберите рейд-босса', '');
      return;
    }
    const packs = this.selectedGroups();
    if (!packs.length) {
      this.toast('warn', 'Выберите хотя бы один пак', '');
      return;
    }
    const participants: RaidParticipant[] = [];
    for (const g of packs) {
      for (const u of g.users ?? []) {
        if (this.isUserOn(g, u)) participants.push({ groupId: g.id, groupName: g.displayName, userId: u.id, name: u.name });
      }
    }
    const drops: RaidDrop[] = this.dropRows()
      .filter((r) => r.name.trim() && r.qty > 0)
      .map((r) => {
        const loot = this.lootOf(r.name);
        return {
          id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          catalogId: this.catalogIndex().get(normName(r.name))?.id ?? null,
          name: r.name.trim(),
          icon: loot?.imgUrl || null,
          grade: loot?.grade ?? null,
          qty: Math.max(1, Math.round(r.qty)),
          dest: this.shared() ? r.dest : 'pack',
          ours: !this.shared() || r.dest === 'pack',
          comment: '',
        };
      });
    const killedAt = this.killDate() ? new Date(this.killDate()).getTime() : Date.now();
    const payload: NewRaidKill = {
      bossId: String(boss.id),
      bossName: boss.name,
      bossIcon: null,
      bossLevel: boss.level ?? null,
      killedAt,
      packIds: packs.map((g) => g.id),
      packNames: packs.map((g) => g.displayName),
      participants,
      drops,
      note: this.note().trim(),
      withFeels: this.withFeels(),
      withClan: this.withClan(),
      dropChecked: this.dropChecked(),
      clanName: '',
    };
    this.saving.set(true);
    try {
      const killId = await this.raidLoot.addKill(payload, this.myEmail());
      // keep the screenshot with the kill (shrunk JPEG, its own doc)
      const shot = this.compressShot();
      if (shot) {
        try {
          await this.raidLoot.saveKillShot(killId, shot);
        } catch {
          this.toast('warn', 'Скрин не сохранился', 'Убийство записано, но без картинки');
        }
      }
      if (this.markAsDead()) {
        try {
          await this.rbJsonResp.setKillTime(String(boss.id), new Date(killedAt), { silent: true });
        } catch {
          this.toast('warn', 'Время смерти не сохранилось', 'Убийство записано, но респ не обновлён');
        }
      }
      this.toast('success', 'Убийство записано', boss.name);
      void this.router.navigateByUrl('/raids');
    } catch (e) {
      this.toast('error', 'Ошибка', e instanceof Error ? e.message : String(e));
    } finally {
      this.saving.set(false);
    }
  }
  /** the loaded screenshot as a JPEG data URL small enough for one Firestore doc (< ~900 KB) */
  private compressShot(): string | null {
    const img = this.image;
    if (!img) return null;
    for (const [maxW, q] of [[1600, 0.72], [1400, 0.62], [1200, 0.55], [1000, 0.5]] as const) {
      const scale = Math.min(1, maxW / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', q);
      if (url.length < 900_000) return url;
    }
    return null;
  }

  cancel(): void {
    void this.router.navigateByUrl('/raids');
  }

  private toast(severity: string, summary: string, detail: string): void {
    this.messages.add({ severity, summary, detail, life: 4500 });
  }
}
