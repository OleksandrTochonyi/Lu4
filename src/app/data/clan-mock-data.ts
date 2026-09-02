/**
 * Mock reference data for the Clan / Users page.
 *
 * Races + 3rd-class professions are taken from Lineage 2 Interlude (Lu4).
 * Combat roles and the equipment catalogue are hand-authored mock data — enough
 * to exercise the paperdoll (every grade D..S, every slot, one-piece "full body"
 * armor, weapon/armor/jewelry slot locking, search + sort).
 */

export type Grade = 'D' | 'C' | 'B' | 'A' | 'S';
export const GRADES: Grade[] = ['D', 'C', 'B', 'A', 'S'];
export const GRADE_RANK: Record<Grade, number> = { D: 1, C: 2, B: 3, A: 4, S: 5 };

export function isGrade(value: unknown): value is Grade {
  return typeof value === 'string' && (GRADES as string[]).includes(value.toUpperCase());
}

/** L2-style grade bracket for a character level — used to colour the level badge. */
export function levelGrade(level: number | null | undefined): Grade | null {
  const l = Number(level) || 0;
  if (l >= 76) return 'S';
  if (l >= 61) return 'A';
  if (l >= 52) return 'B';
  if (l >= 40) return 'C';
  if (l >= 20) return 'D';
  return null;
}

/* ------------------------------------------------------------------ races --- */

export interface Race {
  id: string;
  name: string;
}

export const RACES: Race[] = [
  { id: 'human', name: 'Human' },
  { id: 'elf', name: 'Elf' },
  { id: 'dark-elf', name: 'Dark Elf' },
  { id: 'orc', name: 'Orc' },
  { id: 'dwarf', name: 'Dwarf' },
];

/** Interlude 2nd-class professions, grouped by race id. */
export const PROFESSIONS_BY_RACE: Record<string, string[]> = {
  human: [
    'Warlord',
    'Gladiator',
    'Paladin',
    'Dark Avenger',
    'Treasure Hunter',
    'Hawkeye',
    'Sorcerer',
    'Necromancer',
    'Warlock',
    'Bishop',
    'Prophet',
  ],
  elf: [
    'Temple Knight',
    'Swordsinger',
    'Plains Walker',
    'Silver Ranger',
    'Spellsinger',
    'Elemental Summoner',
    'Elder',
  ],
  'dark-elf': [
    'Shillien Knight',
    'Bladedancer',
    'Abyss Walker',
    'Phantom Ranger',
    'Spellhowler',
    'Phantom Summoner',
    'Shillien Elder',
  ],
  orc: ['Destroyer', 'Tyrant', 'Overlord', 'Warcryer'],
  dwarf: ['Bounty Hunter', 'Warsmith', 'Глиномес'],
};

export function professionsForRace(raceId: string | null | undefined): string[] {
  if (!raceId) return [];
  return PROFESSIONS_BY_RACE[raceId] ?? [];
}

export function raceName(raceId: string | null | undefined): string {
  return RACES.find((r) => r.id === raceId)?.name ?? (raceId ?? '');
}

/* ------------------------------------------------------------------ roles --- */

/** Mock party-roles list. */
export const COMBAT_ROLES: string[] = [
  'Маг ДД',
  'Мили ДД',
  'Арчер',
  'Танк',
  'Хилл',
  'Баффер (ПП)',
  'Заливка',
  'Саппорт',
  'Овер',
  'Спойлер',
  'Крафтер',
];

/** A distinct pastel badge colour per role. */
export const ROLE_COLORS: Record<string, { bg: string; fg: string }> = {
  'Маг ДД': { bg: '#ede9fe', fg: '#6d28d9' },
  'Мили ДД': { bg: '#fee2e2', fg: '#b91c1c' },
  Арчер: { bg: '#dcfce7', fg: '#15803d' },
  Танк: { bg: '#e2e8f0', fg: '#334155' },
  Хилл: { bg: '#cffafe', fg: '#0e7490' },
  'Баффер (ПП)': { bg: '#fef3c7', fg: '#b45309' },
  Заливка: { bg: '#ecfccb', fg: '#4d7c0f' },
  Саппорт: { bg: '#ccfbf1', fg: '#0f766e' },
  Овер: { bg: '#e0e7ff', fg: '#4338ca' },
  Спойлер: { bg: '#fce7f3', fg: '#be185d' },
  Крафтер: { bg: '#ffedd5', fg: '#c2410c' },
};

const ROLE_COLOR_FALLBACK = { bg: '#e2e8f0', fg: '#475569' };

export function roleColor(role: string | null | undefined): { bg: string; fg: string } {
  return (role && ROLE_COLORS[role]) || ROLE_COLOR_FALLBACK;
}

/* --------------------------------------------------------------- catalogue --- */

export type ItemCategory =
  | 'weapon'
  | 'shield'
  | 'armor'
  | 'jewelry'
  | 'cloak'
  | 'belt'
  | 'underwear'
  | 'hair';

/** one Special Ability choice for a weapon (from data.json wiki.saEffects) */
export interface SaEffect {
  tier: string;
  color: string | null;
  name: string;
  effect: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  category: ItemCategory;
  /** weapon: sword/blunt/dagger/bow/dual/fist/spear · armor: helmet/upper/lower/gloves/boots · jewelry: necklace/earring/ring · shield: shield/sigil */
  subtype: string;
  grade: Grade;
  /** full icon URL, when known */
  icon?: string;
  /** "with SA" glow icon (weapons only), when a `-sa` mirror exists */
  iconSa?: string;
  /** available Special Abilities (weapons only) */
  saEffects?: SaEffect[];
}

/** SA orb colour label → hex */
export function saColor(color: string | null | undefined): string {
  switch ((color ?? '').toLowerCase()) {
    case 'красный':
      return '#dc2626';
    case 'зеленый':
    case 'зелёный':
      return '#16a34a';
    case 'синий':
      return '#2563eb';
    default:
      return '#7c3aed';
  }
}

type Raw = [name: string, subtype: string, grade: Grade];

function build(category: ItemCategory, rows: Raw[]): CatalogItem[] {
  return rows.map(([name, subtype, grade], i) => ({
    id: `${category}-${i}`,
    name,
    category,
    subtype,
    grade,
  }));
}

/**
 * The whole equip catalogue (weapons / armor / shields / jewelry) is loaded from
 * `assets/data/data.json` at runtime — see GearCatalogService. EXTRA_ITEMS is a
 * hook for hand-authored additions; currently empty.
 */
export const EXTRA_ITEMS: CatalogItem[] = build('weapon', []);

/* ------------------------------------------------------------------ slots --- */

export interface EquipSlot {
  id: string;
  label: string;
  category: ItemCategory;
  /** allowed item subtypes; omitted = any subtype within the category */
  subtypes?: string[];
  /** icon (emoji, so no icon-font dependency) */
  glyph: string;
  /** centre position on the inventory image, as a percentage of width / height */
  x: number;
  y: number;
  /** the chest slot: when the player marks its item "full body" it also fills `legs` */
  chest?: boolean;
  /** the legs slot: gets locked while the chest item is marked "full body" */
  legs?: boolean;
}

/**
 * 12 equip slots overlaid on `assets/inventory-image.jpg`.
 * x / y are the centre of the box as a percentage of the image width / height.
 */
export const EQUIP_SLOTS: EquipSlot[] = [
  // row 1
  { id: 'helmet', label: 'Шлем', category: 'armor', subtypes: ['helmet'], glyph: '⛑️', x: 53, y: 14 },

  // row 2
  { id: 'gloves', label: 'Перчатки', category: 'armor', subtypes: ['gloves'], glyph: '🧤', x: 26.5, y: 30 },
  { id: 'chest', label: 'Нагрудник', category: 'armor', subtypes: ['upper'], glyph: '👕', x: 53, y: 30, chest: true },
  { id: 'boots', label: 'Сапоги', category: 'armor', subtypes: ['boots'], glyph: '🥾', x: 79, y: 30 },

  // row 3
  { id: 'legs', label: 'Поножи', category: 'armor', subtypes: ['lower'], glyph: '👖', x: 53, y: 44, legs: true },

  // row 4
  { id: 'weapon', label: 'Оружие', category: 'weapon', glyph: '⚔️', x: 37, y: 59 },
  { id: 'shield', label: 'Щит', category: 'shield', glyph: '🛡️', x: 70, y: 59 },

  // row 5 — earrings
  { id: 'necklace', label: 'Серьга 1', category: 'jewelry', subtypes: ['earring'], glyph: '🧿', x: 20, y: 75.5 },
  { id: 'medallion', label: 'Серьга 2', category: 'jewelry', subtypes: ['earring'], glyph: '🧿', x: 53, y: 75.5 },

  // row 6 — rings + necklace
  { id: 'ring1', label: 'Кольцо 1', category: 'jewelry', subtypes: ['ring'], glyph: '💍', x: 20.5, y: 90 },
  { id: 'ring2', label: 'Кольцо 2', category: 'jewelry', subtypes: ['ring'], glyph: '💍', x: 53, y: 90 },
  { id: 'ring3', label: 'Ожерелье', category: 'jewelry', subtypes: ['necklace'], glyph: '📿', x: 85.5, y: 90 },
];

export const SLOT_BY_ID = new Map(EQUIP_SLOTS.map((s) => [s.id, s]));

/* ----------------------------------------------------------------- tattoos --- */

/** the 6 dye stats; the image shown in a tattoo slot is the PLUS stat's picture */
export type TattooStat = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIT' | 'MEN';

export interface Tattoo {
  plus: TattooStat;
  minus: TattooStat;
}

/** the 3 tattoo boxes in the top-left column of the paperdoll */
export interface TattooSlot {
  id: string;
  x: number;
  y: number;
}

export const TATTOO_SLOTS: TattooSlot[] = [
  { id: 'tattoo1', x: 11.5, y: 11.5 },
  { id: 'tattoo2', x: 11.5, y: 18 },
  { id: 'tattoo3', x: 11.5, y: 24 },
];

/** the 12 valid dye combos, split into the physical / magical groups */
export const TATTOO_GROUPS: { label: string; items: Tattoo[] }[] = [
  {
    label: 'Физические',
    items: [
      { plus: 'STR', minus: 'DEX' },
      { plus: 'STR', minus: 'CON' },
      { plus: 'CON', minus: 'STR' },
      { plus: 'CON', minus: 'DEX' },
      { plus: 'DEX', minus: 'STR' },
      { plus: 'DEX', minus: 'CON' },
    ],
  },
  {
    label: 'Магические',
    items: [
      { plus: 'WIT', minus: 'MEN' },
      { plus: 'INT', minus: 'MEN' },
      { plus: 'WIT', minus: 'INT' },
      { plus: 'INT', minus: 'WIT' },
      { plus: 'MEN', minus: 'INT' },
      { plus: 'MEN', minus: 'WIT' },
    ],
  },
];

/** stored in the equipment map under `tattoo1`/`tattoo2`/`tattoo3` as `"PLUS/MINUS"` */
export function tattooCode(t: Tattoo): string {
  return `${t.plus}/${t.minus}`;
}

export function parseTattoo(code: string | null | undefined): Tattoo | null {
  const [plus, minus] = String(code ?? '').split('/');
  const stats: TattooStat[] = ['STR', 'DEX', 'CON', 'INT', 'WIT', 'MEN'];
  if (stats.includes(plus as TattooStat) && stats.includes(minus as TattooStat)) {
    return { plus: plus as TattooStat, minus: minus as TattooStat };
  }
  return null;
}

export function readTattoo(
  equipment: Record<string, string> | null | undefined,
  slotId: string,
): Tattoo | null {
  return parseTattoo((equipment ?? {})[slotId]);
}

/** picture for a tattoo slot — always the PLUS stat's image */
export function tattooImg(stat: TattooStat): string {
  // files are `stat-str.png` … `stat-men.png` — "CON.png" would be a reserved
  // device name on Windows and can't be committed
  return `assets/stat-${stat.toLowerCase()}.png`;
}

export function slotAcceptsItem(slot: EquipSlot, item: CatalogItem): boolean {
  if (item.category !== slot.category) return false;
  if (slot.subtypes && !slot.subtypes.includes(item.subtype)) return false;
  return true;
}

/** pseudo equipment key: the chest item is worn as a one-piece ("full body") */
export const CHEST_FULLBODY_KEY = 'chestFullBody';

/** pseudo equipment key suffix: `<slotId>__enc` holds the item's enchant level */
export const ENCHANT_SUFFIX = '__enc';
export const MAX_ENCHANT = 16;

/** pseudo equipment key: the chosen Special Ability name for the weapon */
export const WEAPON_SA_KEY = 'weaponSa';

/** pseudo equipment key: the weapon is two-handed → the shield slot is blocked */
export const WEAPON_2H_KEY = 'weapon2H';
/** pseudo equipment key: the weapon is a dual (парные) → shield blocked + a 2nd weapon */
export const WEAPON_DUAL_KEY = 'weaponDual';
/** pseudo equipment key: the 2nd weapon item id of a dual */
export const WEAPON_2_KEY = 'weapon2';
/** pseudo equipment key: the hand-picked grade of the resulting dual weapon */
export const WEAPON_DUAL_GRADE_KEY = 'weaponDualGrade';

/** pseudo equipment keys: the 3 tattoo (dye) slots */
export const TATTOO_KEYS = TATTOO_SLOTS.map((s) => s.id);

export function readWeaponSa(equipment: Record<string, string> | null | undefined): string {
  return (equipment ?? {})[WEAPON_SA_KEY] ?? '';
}

export function readWeaponTwoH(equipment: Record<string, string> | null | undefined): boolean {
  return (equipment ?? {})[WEAPON_2H_KEY] === '1' && !!(equipment ?? {})['weapon'];
}
export function readWeaponDual(equipment: Record<string, string> | null | undefined): boolean {
  return (equipment ?? {})[WEAPON_DUAL_KEY] === '1' && !!(equipment ?? {})['weapon'];
}
export function readWeapon2(equipment: Record<string, string> | null | undefined): string {
  return (equipment ?? {})[WEAPON_2_KEY] ?? '';
}
export function readWeaponDualGrade(
  equipment: Record<string, string> | null | undefined,
): Grade | null {
  const g = String((equipment ?? {})[WEAPON_DUAL_GRADE_KEY] ?? '').toUpperCase();
  return isGrade(g) ? (g as Grade) : null;
}
/** the shield slot is unusable while the weapon is two-handed or a dual */
export function isShieldBlocked(equipment: Record<string, string> | null | undefined): boolean {
  return readWeaponTwoH(equipment) || readWeaponDual(equipment);
}

export function enchantKey(slotId: string): string {
  return slotId + ENCHANT_SUFFIX;
}

/** read the enchant level (0..MAX_ENCHANT) for a slot */
export function readEnchant(
  equipment: Record<string, string> | null | undefined,
  slotId: string,
): number {
  const n = Number((equipment ?? {})[enchantKey(slotId)]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_ENCHANT, Math.round(n));
}

/** badge colour for an enchant level — 0..+3 grey, then a distinct colour per step */
const ENCHANT_COLORS: Record<number, string> = {
  4: '#16a34a',
  5: '#22c55e',
  6: '#65a30d',
  7: '#ca8a04',
  8: '#d97706',
  9: '#ea580c',
  10: '#dc2626',
  11: '#e11d48',
  12: '#db2777',
  13: '#c026d3',
  14: '#9333ea',
  15: '#7c3aed',
  16: '#f59e0b',
};

export function enchantColor(level: number): string {
  const v = Math.max(0, Math.min(MAX_ENCHANT, Math.round(level || 0)));
  if (v <= 3) return '#94a3b8';
  return ENCHANT_COLORS[v] ?? '#94a3b8';
}

/**
 * Expand a stored equipment map into a real slotId -> itemId map:
 *  - drops the CHEST_FULLBODY_KEY flag and every `__enc` entry
 *  - when the flag is set, mirrors the chest item into the `legs` slot so a
 *    one-piece armor counts as two pieces everywhere (stats, gear score, …)
 */
export function expandEquipment(
  equipment: Record<string, string> | null | undefined,
): Record<string, string> {
  const src = equipment ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    if (
      k === CHEST_FULLBODY_KEY ||
      k === WEAPON_SA_KEY ||
      k === WEAPON_2H_KEY ||
      k === WEAPON_DUAL_KEY ||
      k === WEAPON_2_KEY ||
      k === WEAPON_DUAL_GRADE_KEY ||
      k.endsWith(ENCHANT_SUFFIX) ||
      TATTOO_KEYS.includes(k)
    )
      continue;
    out[k] = v;
  }
  if (src[CHEST_FULLBODY_KEY] === '1' && out['chest']) out['legs'] = out['chest'];
  return out;
}

/** Category label for the picker header / empty states. */
export const CATEGORY_LABEL: Record<ItemCategory, string> = {
  weapon: 'Оружие',
  shield: 'Щиты',
  armor: 'Броня',
  jewelry: 'Бижутерия',
  cloak: 'Плащи',
  belt: 'Пояса',
  underwear: 'Бельё',
  hair: 'Аксессуары',
};

/** Subtype options offered when a user manually re-labels an item. */
export const SUBTYPE_OPTIONS: Record<ItemCategory, { label: string; value: string }[]> = {
  weapon: [
    { label: 'Меч', value: 'sword' },
    { label: 'Дубина', value: 'blunt' },
    { label: 'Кинжал', value: 'dagger' },
    { label: 'Лук', value: 'bow' },
    { label: 'Копьё', value: 'spear' },
    { label: 'Кастет', value: 'fist' },
    { label: 'Парные мечи', value: 'dual' },
    { label: 'Посох', value: 'staff' },
    { label: 'Прочее', value: 'other' },
  ],
  armor: [
    { label: 'Шлем', value: 'helmet' },
    { label: 'Нагрудник', value: 'upper' },
    { label: 'Поножи', value: 'lower' },
    { label: 'Перчатки', value: 'gloves' },
    { label: 'Сапоги', value: 'boots' },
  ],
  jewelry: [
    { label: 'Ожерелье', value: 'necklace' },
    { label: 'Серьга', value: 'earring' },
    { label: 'Кольцо', value: 'ring' },
  ],
  shield: [
    { label: 'Щит', value: 'shield' },
    { label: 'Сигил', value: 'sigil' },
  ],
  cloak: [{ label: 'Плащ', value: 'cloak' }],
  belt: [{ label: 'Пояс', value: 'belt' }],
  underwear: [{ label: 'Бельё', value: 'underwear' }],
  hair: [{ label: 'Аксессуар', value: 'hair' }],
};
