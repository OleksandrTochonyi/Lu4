/**
 * Add a SECOND icon per weapon: its masterwork.wiki "with SA" (special-ability /
 * glow) variant, saved next to the base icon with a `-sa` suffix
 *   war-pick.webp        -> the plain lu4db.ru icon (left untouched)
 *   war-pick-sa.webp     -> the masterwork.wiki "with SA" icon (added here)
 *
 * masterwork.wiki icon URLs look like
 *   https://masterwork.wiki/i64/weapon_<internal>_i0N.<ext>
 * and neither the internal slug, the `_i0N` suffix nor the extension is
 * predictable from the display name, so resolution goes:
 *   1. explicit URL from scripts/sa-icon-overrides.json  (name -> full URL)
 *   2. explicit URL from a raw `iconSa` / `saIcon` field on the data.json item
 *   3. name -> internal-slug override table scraped from rb-data.ts
 *   4. guessed slugs (naive, possessive-stripped, "the"-stripped) crossed with
 *      suffixes i00..i02 and extensions png/jpg/webp
 * Weapons with no `wiki.saEffects` (can't take an SA) and `*`-name duplicates are
 * skipped. Existing `-sa` files are kept, so re-runs only fill gaps.
 *
 * Run: node scripts/fetch-weapon-sa-icons.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'src/assets/data/data.json');
const RB_DATA = path.join(ROOT, 'src/app/services/rb-data.ts');
const OVERRIDES_JSON = path.join(ROOT, 'scripts/sa-icon-overrides.json');
const OUT = path.join(ROOT, 'public/assets/item-icons');
/** manifest the app reads: which base-icon filenames have a `<base>-sa.png` mirror */
const MANIFEST = path.join(ROOT, 'src/assets/data/sa-icons.json');
const CONCURRENCY = 8;

const SUFFIXES = ['i01', 'i00', 'i02'];
const EXTS = ['png', 'jpg', 'webp'];

// masterwork.wiki mirrors are always PNG → always write `<base>-sa.png`
const saName = (base) => base.replace(/\.[^.]+$/, '-sa.png');

function slugCandidates(name) {
  const lower = name.toLowerCase();
  const base = lower.replace(/['’]/g, '');
  const naive = base.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const noThe = naive.replace(/(^|_)the(_|$)/g, '$1').replace(/^_+|_+$/g, '');
  const possessive = lower
    .replace(/['’]s\b/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  // masterwork.wiki sometimes reverses the words: "Karik Horn" -> "horn_of_karik",
  // "Sword of Miracles" -> "sword_of_miracle", "X of Y" <-> "Y of X"
  const swaps = [];
  const words = naive.split('_').filter(Boolean);
  if (words.length === 2) swaps.push(`${words[1]}_of_${words[0]}`, `${words[1]}_${words[0]}`);
  const io = naive.indexOf('_of_');
  if (io > 0) swaps.push(`${naive.slice(io + 4)}_of_${naive.slice(0, io)}`);

  return [...new Set([naive, possessive, noThe, ...swaps].filter(Boolean))];
}

async function fetchImage(url) {
  const res = await fetch(url, { redirect: 'follow' });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('image/')) return null;
  return Buffer.from(await res.arrayBuffer());
}

async function trySlug(slug) {
  for (const suffix of SUFFIXES) {
    for (const ext of EXTS) {
      const url = `https://masterwork.wiki/i64/weapon_${slug}_${suffix}.${ext}`;
      const buf = await fetchImage(url).catch(() => null);
      if (buf) return { url, buf };
    }
  }
  return null;
}

// name (lowercase) -> masterwork.wiki internal slug, scraped from rb-data.ts
async function loadRbSlugs() {
  const src = await readFile(RB_DATA, 'utf8');
  const re =
    /displayName:\s*"([^"]+)",\s*imgUrl:\s*"https:\/\/masterwork\.wiki\/(?:icon64|i64)\/weapon_(.+?)_i0[01]\.png"/g;
  const map = new Map();
  let m;
  while ((m = re.exec(src))) map.set(m[1].toLowerCase(), m[2]);
  return map;
}

const raw = JSON.parse(await readFile(DATA, 'utf8'));
const items = Object.values(raw?.itemCatalog?.items ?? {});
const weapons = items.filter(
  (o) =>
    o?.kind === 'finished' &&
    o?.icon &&
    (o.section ?? '').startsWith('weapon-') &&
    !/[*]/.test(o.name) &&
    Array.isArray(o?.wiki?.saEffects) &&
    o.wiki.saEffects.length,
);

const uniq = new Map(); // basename -> raw item
for (const o of weapons) {
  const b = o.icon.split('/').pop();
  if (!uniq.has(b)) uniq.set(b, o);
}

const explicit = JSON.parse(await readFile(OVERRIDES_JSON, 'utf8'));
const rbSlugs = await loadRbSlugs();
const entries = [...uniq.entries()];
console.log(`${entries.length} SA weapons — adding masterwork.wiki "-sa" icons…`);

let added = 0;
let skipped = 0;
const missed = [];

async function run([base, o]) {
  const out = path.join(OUT, saName(base));
  if (existsSync(out)) {
    skipped++;
    return;
  }

  // 1 + 2: explicit URL
  const url = explicit[o.name] || o.iconSa || o.saIcon;
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    const buf = await fetchImage(url).catch(() => null);
    if (buf) {
      await writeFile(out, buf);
      added++;
      console.log(`  ✓ ${o.name} -> ${url}  (explicit)`);
      return;
    }
  }

  // 3 + 4: slug table, then guesses
  const slugs = [rbSlugs.get(o.name.toLowerCase()), ...slugCandidates(o.name)].filter(Boolean);
  for (const slug of [...new Set(slugs)]) {
    const found = await trySlug(slug);
    if (found) {
      await writeFile(out, found.buf);
      added++;
      console.log(`  ✓ ${o.name} -> ${found.url}`);
      return;
    }
  }

  missed.push(o.name);
  console.log(`  · ${o.name} — no match`);
}

for (let i = 0; i < entries.length; i += CONCURRENCY) {
  await Promise.all(entries.slice(i, i + CONCURRENCY).map(run));
}

// rebuild the manifest: every base-icon filename that now has a `-sa.png` file
const manifest = entries
  .filter(([base]) => existsSync(path.join(OUT, saName(base))))
  .map(([base]) => base)
  .sort();
await writeFile(MANIFEST, JSON.stringify(manifest, null, 0) + '\n');
console.log(`manifest: ${manifest.length} entries -> ${path.relative(ROOT, MANIFEST)}`);

console.log(`\ndone: ${added} added, ${skipped} already present, ${missed.length} unresolved`);
if (missed.length) {
  console.log(
    `\nadd URLs for these to scripts/sa-icon-overrides.json:\n${missed
      .map((n) => `  "${n}": ""`)
      .join(',\n')}`,
  );
}
