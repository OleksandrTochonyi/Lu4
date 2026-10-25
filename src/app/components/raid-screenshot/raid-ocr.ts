/**
 * «Рейд по скрину»: OCR of a Lineage 2 screenshot (English client) in the browser
 * with tesseract.js (lazy-loaded), plus fuzzy matching of what it read against the
 * known names (КП players, raid bosses, drop tables). The fuzzy match is what makes
 * free OCR usable: we never need to read arbitrary text, only to find the closest
 * known name.
 */

/** a screenshot region, as fractions of the image size */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type RegionKey = 'party' | 'cc' | 'drop';
export type Regions = Record<RegionKey, Region>;

export const DEFAULT_REGIONS: Regions = {
  party: { x: 0.02, y: 0.01, w: 0.085, h: 0.53 },
  cc: { x: 0.876, y: 0.405, w: 0.115, h: 0.095 },
  drop: { x: 0, y: 0.735, w: 0.15, h: 0.095 },
};

// ------------------------------------------------------------------ preprocessing

/**
 * Crop → ×3 → per pixel v = max(r,g,b) (keeps pink / cyan text) → inverted with
 * contrast: dark text on white. Without this, game UI OCRs as garbage.
 */
export function prepareRegion(img: HTMLImageElement, r: Region): HTMLCanvasElement {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const sx = Math.max(0, Math.round(r.x * W));
  const sy = Math.max(0, Math.round(r.y * H));
  const sw = Math.max(1, Math.min(W - sx, Math.round(r.w * W)));
  const sh = Math.max(1, Math.min(H - sy, Math.round(r.h * H)));
  const scale = 3;
  const c = document.createElement('canvas');
  c.width = sw * scale;
  c.height = sh * scale;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const v = Math.max(p[i], p[i + 1], p[i + 2]);
    const inv = 255 - Math.min(255, Math.max(0, (v - 60) * 1.6));
    p[i] = p[i + 1] = p[i + 2] = inv;
    p[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

// ------------------------------------------------------------------ tesseract (one worker, reused)

let workerPromise: Promise<any> | null = null;
let progressCb: ((stage: string, pct: number) => void) | null = null;

export function setOcrProgress(cb: ((stage: string, pct: number) => void) | null): void {
  progressCb = cb;
}

async function getWorker(): Promise<any> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const T: any = await import('tesseract.js');
      const createWorker = T.createWorker ?? T.default?.createWorker;
      const PSM = T.PSM ?? T.default?.PSM;
      const w = await createWorker('eng', 1, {
        logger: (m: any) => progressCb?.(String(m?.status ?? ''), Math.round((Number(m?.progress) || 0) * 100)),
      });
      await w.setParameters({ tessedit_pageseg_mode: PSM?.SINGLE_BLOCK ?? '6', preserve_interword_spaces: '1' });
      return w;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

export async function ocr(canvas: HTMLCanvasElement): Promise<string> {
  const w = await getWorker();
  const res = await w.recognize(canvas);
  return String(res?.data?.text ?? '');
}

// ------------------------------------------------------------------ fuzzy matching

/** lower case, [i 1 | !] → l, 0 → o, keep letters/digits only — IloHoc ≈ lloHoc */
export function fold(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[i1|!]/g, 'l')
    .replace(/0/g, 'o')
    .replace(/[^a-zа-яё0-9]/g, '');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 1 − distance / longer length, on folded strings */
export function similarity(a: string, b: string): number {
  const fa = fold(a);
  const fb = fold(b);
  if (!fa || !fb) return 0;
  return 1 - levenshtein(fa, fb) / Math.max(fa.length, fb.length);
}

/** nick threshold by folded length: ≤3 exact only, ≤5 → 0.8, longer → 0.72 */
function nickThreshold(s: string): number {
  const n = fold(s).length;
  return n <= 3 ? 1 : n <= 5 ? 0.8 : 0.72;
}

/** best candidate above the threshold */
function best<T>(raw: string, items: T[], nameOf: (t: T) => string, threshold: number): { item: T; score: number } | null {
  let top: { item: T; score: number } | null = null;
  for (const it of items) {
    const sc = similarity(raw, nameOf(it));
    if (sc >= threshold && (!top || sc > top.score)) top = { item: it, score: sc };
  }
  return top;
}

// ------------------------------------------------------------------ party window

export interface RosterPlayer {
  groupId: string;
  groupName: string;
  userId: string;
  name: string;
  isPL: boolean;
  isTwink: boolean;
}

export interface PartyResult {
  /** the pack most matched nicks belong to */
  groupId: string | null;
  groupName: string;
  /** recognised players of that pack */
  players: RosterPlayer[];
  /** a player of another pack, or a read word that matched nobody */
  doubtful: { raw: string; player: RosterPlayer | null }[];
  raw: string;
}

const WORD = /[A-Za-zА-Яа-яЁё0-9_]{3,}/g;

/** one nick per line: the longest word with a letter in it, matched to the КП roster */
export function parseParty(text: string, roster: RosterPlayer[]): PartyResult {
  const hits: { raw: string; player: RosterPlayer | null }[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const words = (line.match(WORD) ?? []).filter((w) => /[A-Za-zА-Яа-яЁё]/.test(w));
    if (!words.length) continue;
    const word = words.sort((a, b) => b.length - a.length)[0];
    const m = best(word, roster, (p) => p.name, nickThreshold(word));
    if (m) {
      if (seen.has(m.item.userId)) continue;
      seen.add(m.item.userId);
    }
    hits.push({ raw: word, player: m?.item ?? null });
  }
  const votes = new Map<string, number>();
  for (const h of hits) if (h.player) votes.set(h.player.groupId, (votes.get(h.player.groupId) ?? 0) + 1);
  const groupId = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const players = hits.filter((h) => h.player && h.player.groupId === groupId).map((h) => h.player!);
  const doubtful = hits.filter(
    (h) => (h.player && h.player.groupId !== groupId) || (!h.player && fold(h.raw).length >= 4),
  );
  return { groupId, groupName: players[0]?.groupName ?? '', players, doubtful, raw: text };
}

// ------------------------------------------------------------------ Command Channel window

export interface CcPack {
  groupId: string;
  groupName: string;
  leader: string;
  /** «Feels 9» — people in that party per the CC window; null when it shows names only */
  inGame: number | null;
}
export interface CcResult {
  packs: CcPack[];
  /** CC leaders that match nobody in our roster — another clan */
  foreign: { raw: string; inGame: number | null }[];
  raw: string;
}

const CC_SKIP = new Set(['owner', 'looting', 'general', 'leader', 'party', 'refresh', 'dismiss', 'quit', 'command', 'channel', 'info']);

/** window title / buttons — also cut-off ones like «Leade» (Leader) */
function isCcService(word: string): boolean {
  const w = word.toLowerCase();
  if (CC_SKIP.has(w)) return true;
  return w.length >= 4 && [...CC_SKIP].some((s) => s.startsWith(w) || w.startsWith(s));
}

export function parseCc(text: string, roster: RosterPlayer[], ourGroupId: string | null): CcResult {
  const packs: CcPack[] = [];
  const foreign: { raw: string; inGame: number | null }[] = [];
  const pls = roster.filter((p) => p.isPL);
  for (const line of text.split(/\r?\n/)) {
    // «Feels 9», or just «Feels» — the narrow CC window shows only the leaders' names
    const m = /([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9_]{1,})(?:\s+(\d{1,2}))?\s*$/.exec(line.trim());
    if (!m) continue;
    const raw = m[1];
    if (isCcService(raw)) continue;
    const inGame = m[2] != null ? Number(m[2]) : null;
    const th = nickThreshold(raw);
    const hit = best(raw, pls, (p) => p.name, th) ?? best(raw, roster, (p) => p.name, th);
    if (!hit) {
      foreign.push({ raw, inGame });
      continue;
    }
    const p = hit.item;
    if (p.groupId === ourGroupId || packs.some((x) => x.groupId === p.groupId)) continue;
    packs.push({ groupId: p.groupId, groupName: p.groupName, leader: p.name, inGame });
  }
  return { packs, foreign, raw: text };
}

// ------------------------------------------------------------------ system chat: drop lines

export interface BossRef {
  id: string;
  name: string;
  loot: { displayName: string; imgUrl?: string; grade?: string; qty?: number | string }[];
}
export interface DropItem {
  /** canonical name from the drop table, or what OCR read when unmatched */
  name: string;
  raw: string;
  qty: number;
  /** what OCR read when it was impossible for this item (above the drop table max) */
  ocrQty: number | null;
  matched: boolean;
  icon: string | null;
  grade: string | null;
}
export interface DropResult {
  /** boss name as read in the lines (majority) */
  bossRead: string;
  boss: BossRef | null;
  items: DropItem[];
  /** «… died and dropped …» lines whose item matched nothing */
  unmatchedLines: string[];
  raw: string;
}

/** «… died and dropped …» — keyed on «dropped», «died» gets mangled by OCR (dled, dicd …) */
const DROP_MARK = /\bdr[o0][pq]{1,2}[e3c]d\b/i;
/** boss, «died and» (any spelling), qty (with OCR look-alikes), item */
const DROP_LINE = /^(.+?)\s+\S{2,6}\s+(?:and|ard|end)\s+dr[o0][pq]{1,2}[e3c]d\s+([0-9SsOoIlZzB|]{1,3})\s+(.+?)\.?$/i;

/** OCR reads digits as letters: S→5, O→0, l/I/|→1, Z→2, B→8 */
/** OCR look-alikes → digits, as a string («S5» → «55») */
function ocrDigits(s: string): string {
  const map: Record<string, string> = { s: '5', o: '0', l: '1', i: '1', '|': '1', z: '2', b: '8' };
  return String(s).toLowerCase().replace(/[soli|zb]/g, (c) => map[c] ?? c).replace(/\D/g, '');
}

/** the most that can drop at once per the table: 1 or «2 - 5» → 5; null = unknown */
function tableMax(qty: number | string | undefined): number | null {
  if (qty == null || qty === '') return null;
  const nums = String(qty).match(/\d+/g)?.map(Number) ?? [];
  return nums.length ? Math.max(...nums) : null;
}

/** «55» read for an item that drops 2–5 → the biggest number made of those digits that fits */
function fitQty(digits: string, max: number): number {
  let bestN = 0;
  for (let i = 0; i < digits.length; i++)
    for (let j = i + 1; j <= digits.length; j++) {
      const n = Number(digits.slice(i, j));
      if (n >= 1 && n <= max && n > bestN) bestN = n;
    }
  return bestN || max;
}

function ocrNumber(s: string): number {
  const map: Record<string, string> = { s: '5', o: '0', l: '1', i: '1', '|': '1', z: '2', b: '8' };
  const n = Number(
    String(s)
      .toLowerCase()
      .replace(/[soli|zb]/g, (c) => map[c] ?? c),
  );
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** what OCR read after «dropped N»: cut the next system message, drop stray marks */
export function cleanItem(raw: string): string {
  let s = String(raw ?? '')
    .replace(/[\[\]|{}]/g, ' ')
    .replace(/\s+[A-Za-z]\.(?=\s)/g, ' ') // «Demon's o. Dagger»
    .replace(/\s+/g, ' ')
    .trim();
  // «… (B- Grade). Eva's Replenishment has worn off.» → up to the first sentence end
  const end = s.search(/\)\.\s|\.\s+[A-Z]/);
  if (end >= 0) s = s.slice(0, s[end] === ')' ? end + 1 : end);
  // «(B- Grade)» → «(B-Grade)»
  return s
    .replace(/\(\s*([^()]*?)\s*\)/g, (_m, x: string) => `(${x.replace(/-\s+/g, '-')})`)
    .replace(/\.$/, '')
    .trim();
}

function tokens(s: string): string[] {
  return String(s ?? '')
    .split(/[^A-Za-zА-Яа-яЁё0-9]+/)
    .map(fold)
    .filter(Boolean);
}
function tokenEq(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length) >= 0.8;
}

/**
 * The drop-table entry this OCR text means. 1) close match of the whole cleaned
 * name; 2) every word of an entry's name found, in order, in the read text — extra
 * words (Unidentified, OCR junk, the next chat message) don't matter. A «Recipe» is
 * never matched to the item itself and vice versa.
 */
export function matchItem(raw: string, pool: { displayName: string; imgUrl?: string; grade?: string; qty?: number | string }[]) {
  const clean = cleanItem(raw);
  const whole = best(clean, pool, (l) => l.displayName, 0.75);
  if (whole) return whole.item;
  const rt = tokens(raw);
  const isRecipe = rt.includes('reclpe') || rt.includes('recipe');
  let top: { item: (typeof pool)[number]; cover: number; len: number } | null = null;
  for (const l of pool) {
    const lt = tokens(l.displayName);
    if (!lt.length) continue;
    const lRecipe = lt.includes('reclpe') || lt.includes('recipe');
    if (lRecipe !== isRecipe) continue;
    let i = 0;
    let hit = 0;
    for (const t of lt) {
      let j = i;
      while (j < rt.length && !tokenEq(rt[j], t)) j++;
      if (j < rt.length) {
        hit++;
        i = j + 1;
      }
    }
    const cover = hit / lt.length;
    if (cover < 0.85) continue;
    if (!top || cover > top.cover || (cover === top.cover && lt.length > top.len)) top = { item: l, cover, len: lt.length };
  }
  return top?.item ?? null;
}

export function parseDrop(text: string, bosses: BossRef[]): DropResult {
  // glue wrapped lines: a line without «died and drop» belongs to the previous one
  const lines: string[] = [];
  for (const ln of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (DROP_MARK.test(ln) || !lines.length) lines.push(ln);
    else lines[lines.length - 1] += ' ' + ln;
  }
  const parsed: { boss: string; qty: number; digits: string; item: string; line: string }[] = [];
  /** looks like a drop message but didn't parse — shown, never silently dropped */
  const broken: string[] = [];
  for (const l of lines) {
    const flat = l.replace(/\s+/g, ' ');
    const m = DROP_LINE.exec(flat);
    if (m) parsed.push({ boss: m[1].trim(), qty: ocrNumber(m[2]), digits: ocrDigits(m[2]), item: m[3].trim(), line: m[0] });
    else if (DROP_MARK.test(flat)) broken.push(flat);
  }

  // boss: majority vote over the lines
  const votes = new Map<string, { boss: BossRef; n: number }>();
  let bossRead = '';
  for (const p of parsed) {
    const hit = best(p.boss, bosses, (b) => b.name, 0.75);
    if (!bossRead) bossRead = p.boss;
    if (!hit) continue;
    const v = votes.get(hit.item.id) ?? { boss: hit.item, n: 0 };
    v.n++;
    votes.set(hit.item.id, v);
  }
  const boss = [...votes.values()].sort((a, b) => b.n - a.n)[0]?.boss ?? null;
  if (boss) bossRead = parsed.find((p) => similarity(p.boss, boss.name) >= 0.75)?.boss ?? bossRead;

  // items: this boss's drop table first; every table only when the boss wasn't found
  const pool = boss ? boss.loot : bosses.flatMap((b) => b.loot);
  const byName = new Map<string, DropItem>();
  const unmatchedLines: string[] = [...broken];
  for (const p of parsed) {
    const loot = matchItem(p.item, pool);
    const hit = loot ? { item: loot } : null;
    if (!hit) unmatchedLines.push(p.line);
    const name = hit ? hit.item.displayName : cleanItem(p.item);
    // impossible count for this item (OCR doubled a digit: 5 → 55) → fit it to the table
    let qty = p.qty;
    let ocrQty: number | null = null;
    const max = hit ? tableMax(hit.item.qty) : null;
    if (max != null && qty > max) {
      ocrQty = qty;
      qty = fitQty(p.digits, max);
    }
    const key = name.toLowerCase();
    const cur = byName.get(key);
    if (cur) cur.qty += qty;
    else
      byName.set(key, {
        name,
        raw: p.item,
        qty,
        ocrQty,
        matched: !!hit,
        icon: hit?.item.imgUrl || null,
        grade: hit?.item.grade ?? null,
      });
  }
  return { bossRead, boss, items: [...byName.values()], unmatchedLines, raw: text };
}
