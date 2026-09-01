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

const raw = JSON.parse(await readFile(DATA, 'utf8'));
const items = Object.values(raw?.itemCatalog?.items ?? {});
const icons = [
  ...new Set(items.filter((o) => o?.kind === 'finished' && o?.icon).map((o) => o.icon)),
];

await mkdir(OUT, { recursive: true });

let ok = 0;
let skipped = 0;
let failed = 0;

async function grab(iconPath) {
  const file = path.join(OUT, path.basename(iconPath));
  if (existsSync(file) && (await stat(file)).size > 0) {
    skipped++;
    return;
  }
  try {
    const res = await fetch(BASE + iconPath, { redirect: 'follow' });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) throw new Error(`${res.status} ${type}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    ok++;
  } catch (e) {
    failed++;
    console.warn(`  ✗ ${iconPath} — ${e.message}`);
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

