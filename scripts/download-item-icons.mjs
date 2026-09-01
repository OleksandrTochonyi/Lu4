/**
 * Mirror the item icons referenced by src/assets/data/data.json into
 * public/assets/item-icons/ so the Clan page doesn't depend on lu4db.ru
 * (which isn't reachable for every user).
 *
 * Run:  node scripts/download-item-icons.mjs
 * Re-run whenever data.json changes. Existing non-empty files are skipped.
 */
import { readFile, mkdir, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'src/assets/data/data.json');
const OUT = path.join(ROOT, 'public/assets/item-icons');
const BASE = 'https://lu4db.ru';
const CONCURRENCY = 16;

/**
 * A handful of "SA" (special-ability) weapons are missing/broken on lu4db.ru but
 * exist on masterwork.wiki under a different internal name — keyed by the local
 * filename (basename of data.json's `icon`), tried when the lu4db.ru fetch fails.
 * masterwork.wiki icon URLs look like
 * https://masterwork.wiki/i64/weapon_<internal-name>_i01.png — the internal name
 * often doesn't match the display name (e.g. "Bow of Peril" → "hazard_bow"); a
 * starting map of those is the weapon-name → imgUrl table in
 * src/app/services/rb-data.ts. Add more pairs here as gaps turn up.
 */
const FALLBACKS = {
  'bow-of-periel.webp': 'https://masterwork.wiki/i64/weapon_hazard_bow_i01.png',
  // 17 items that 404 on lu4db.ru — recovered from l2api.dev's icon set
  // (https://l2api.dev/icons/<iconFile>). PNG bytes; browsers sniff them fine.
  // A few are approximate (set + slot match) where the exact piece isn't listed.
  'dark-crystal-robe-stockings.webp': 'https://l2api.dev/icons/armor_t76_l_i00.png',
  'tm-dle-dual.webp': 'https://l2api.dev/icons/weapon_dual_sword_i00.png',
  'doom-tunic.webp': 'https://l2api.dev/icons/armor_t73_u_i00.png',
  'doom-gaiters.webp': 'https://l2api.dev/icons/armor_t71_l_i00.png',
  'doom-stockings.webp': 'https://l2api.dev/icons/armor_t73_l_i00.png',
  'blue-wolf-light-boots.webp': 'https://l2api.dev/icons/armor_t69_b_i00.png',
  'blue-wolf-light-gloves.webp': 'https://l2api.dev/icons/armor_t69_g_i00.png',
  'blue-wolf-light-helmet.webp': 'https://l2api.dev/icons/armor_leather_helmet_i00.png',
  'blue-wolf-circlet.webp': 'https://l2api.dev/icons/armor_leather_helmet_i00.png',
  'blue-wolf-leather-leggings.webp': 'https://l2api.dev/icons/armor_t69_l_i00.png',
  'avadon-helmet.webp': 'https://l2api.dev/icons/armor_helmet_i00.png',
  'avadon-leather-leggings.webp': 'https://l2api.dev/icons/armor_t67_l_i00.png',
  'half-plate-gauntlets-design.webp': 'https://l2api.dev/icons/etc_pouch_brown_i00.png',
  'earring-of-binding.webp': 'https://l2api.dev/icons/accessary_earing_of_binding_i00.png',
  'ring-of-binding.webp': 'https://l2api.dev/icons/accessary_ring_of_binding_i00.png',
  'necklace-of-binding.webp': 'https://l2api.dev/icons/accessary_necklace_of_binding_i00.png',
  'antidote.webp': 'https://l2api.dev/icons/etc_herb_green_i00.png',
};

const raw = JSON.parse(await readFile(DATA, 'utf8'));
const items = Object.values(raw?.itemCatalog?.items ?? {});
// every catalogue row that carries an icon — finished gear, resources, parts,
// recipes, misc — so the Warehouse craft catalogue can show them all.
const icons = [...new Set(items.filter((o) => o?.icon).map((o) => o.icon))];

await mkdir(OUT, { recursive: true });

let ok = 0;
let skipped = 0;
let failed = 0;

async function fetchImage(url) {
  const res = await fetch(url, { redirect: 'follow' });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('image/')) throw new Error(`${res.status} ${type}`);
  return Buffer.from(await res.arrayBuffer());
}

async function grab(iconPath) {
  const name = path.basename(iconPath);
  const file = path.join(OUT, name);
  if (existsSync(file) && (await stat(file)).size > 0) {
    skipped++;
    return;
  }
  try {
    await writeFile(file, await fetchImage(BASE + iconPath));
    ok++;
  } catch (primaryErr) {
    const fallback = FALLBACKS[name];
    if (fallback) {
      try {
        await writeFile(file, await fetchImage(fallback));
        ok++;
        console.log(`  ↺ ${name} — recovered from fallback`);
        return;
      } catch (fallbackErr) {
        failed++;
        console.warn(`  ✗ ${iconPath} — ${primaryErr.message} (fallback also failed: ${fallbackErr.message})`);
        return;
      }
    }
    failed++;
    console.warn(`  ✗ ${iconPath} — ${primaryErr.message}`);
  }
}

console.log(`${icons.length} unique icons → ${path.relative(ROOT, OUT)}`);
for (let i = 0; i < icons.length; i += CONCURRENCY) {
  await Promise.all(icons.slice(i, i + CONCURRENCY).map(grab));
}

// drop anything that isn't a real image (e.g. an old 404 page saved before)
for (const name of await readdir(OUT)) {
  const buf = await readFile(path.join(OUT, name));
  const head = buf.subarray(0, 12);
  const isWebp = head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP';
  const isPng = head[0] === 0x89 && head.toString('ascii', 1, 4) === 'PNG';
  const isJpg = head[0] === 0xff && head[1] === 0xd8;
  if (!isWebp && !isPng && !isJpg) {
    await rm(path.join(OUT, name));
    console.warn(`  – removed non-image ${name}`);
  }
}

