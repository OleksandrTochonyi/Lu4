#!/usr/bin/env node
/**
 * Updates raid-boss level / HP / stats in src/assets/data/db.json from a SAVED copy
 * of the masterwork wiki page (the site blocks scripts, so save it in a browser:
 * https://masterwork.wiki/lu4-gamma/posts/post/385-raid-bosses → Ctrl+S).
 *
 *   node scripts/sync-rb-wiki.mjs "<saved page.html>"           # report only
 *   node scripts/sync-rb-wiki.mjs "<saved page.html>" --apply   # report + write db.json
 *
 * Matching is by NPC id (wiki link …/npc/25375-zombie-lord-ferkel ↔ db.json "id": "25375").
 * Updated fields: level, hp, mp, patk, matk, pdef, mdef, exp, sp, attackAttribute,
 * defenseAttribute. Names, resp, locations, skills, drop are NOT touched. Bosses that
 * exist on only one side are listed, never added / removed.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(ROOT, 'src/assets/data/db.json');
/** outside src/ so the backup never ends up in the build (gitignored) */
const BACKUP_DIR = join(ROOT, '.rb-sync-backup');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node scripts/sync-rb-wiki.mjs "<saved wiki page.html>" [--apply]');
  process.exit(1);
}

/** wiki stat label → db.json field (numbers) */
const NUM_FIELDS = {
  HP: 'hp',
  MP: 'mp',
  'P. Atk.': 'patk',
  'M. Atk.': 'matk',
  'P. Def.': 'pdef',
  'M. Def.': 'mdef',
  Exp: 'exp',
  SP: 'sp',
};
/** wiki stat label → db.json field (text) */
const TEXT_FIELDS = {
  'Attack Attribute': 'attackAttribute',
  'Defense Attribute': 'defenseAttribute',
};

const text = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
const num = (s) => {
  const n = Number(String(s).replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// ------------------------------------------------------------------ parse wiki

function parseWiki(html) {
  const link = /<a href="https:\/\/masterwork\.wiki\/lu4-gamma\/npc\/(\d+)-[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const heads = [];
  let m;
  while ((m = link.exec(html))) {
    const label = text(m[2]);
    const lvl = /Lv\.\s*(\d+)/.exec(label);
    if (!lvl) continue;
    heads.push({ id: m[1], label, level: Number(lvl[1]), start: m.index, end: link.lastIndex });
  }
  const out = new Map();
  heads.forEach((h, i) => {
    // this boss's block: up to the next boss heading
    const block = html.slice(h.end, i + 1 < heads.length ? heads[i + 1].start : html.length);
    const statsAt = block.indexOf('npc-stats');
    if (statsAt < 0) return;
    const table = block.slice(statsAt, block.indexOf('</table>', statsAt));
    const cells = [...table.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1]));
    const stats = {};
    for (let k = 0; k + 1 < cells.length; k += 2) {
      const label = cells[k];
      if (label in NUM_FIELDS) stats[NUM_FIELDS[label]] = num(cells[k + 1]);
      else if (label in TEXT_FIELDS) stats[TEXT_FIELDS[label]] = cells[k + 1];
    }
    const name = h.label.replace(/\s*(Raid Boss|Epic Boss|Queen of Underground|Lv\.\s*\d+).*$/, '').trim();
    if (!out.has(h.id)) out.set(h.id, { id: h.id, name, level: h.level, ...stats });
  });
  return out;
}

// ------------------------------------------------------------------ main

const html = readFileSync(file, 'utf8');
const wiki = parseWiki(html);
const raw = readFileSync(DB, 'utf8');
const db = JSON.parse(raw);
const monsters = db.monsters ?? [];

const FIELDS = ['level', ...Object.values(NUM_FIELDS), ...Object.values(TEXT_FIELDS)];
const changed = [];
const missingOnWiki = [];
for (const mon of monsters) {
  const w = wiki.get(String(mon.id));
  if (!w) {
    missingOnWiki.push(`${mon.id} ${mon.name} (lv ${mon.level})`);
    continue;
  }
  const diffs = [];
  for (const f of FIELDS) {
    const v = w[f];
    if (v == null || v === '') continue;
    if (mon[f] !== v) {
      diffs.push(`${f}: ${mon[f] ?? '—'} → ${v}`);
      if (APPLY) mon[f] = v;
    }
  }
  if (diffs.length) changed.push({ mon, diffs });
}
const ours = new Set(monsters.map((m) => String(m.id)));
const onlyWiki = [...wiki.values()].filter((w) => !ours.has(w.id));

console.log(`wiki: ${wiki.size} bosses with stats · db.json: ${monsters.length}`);
console.log(`\nchanged: ${changed.length}`);
for (const { mon, diffs } of changed) console.log(`  ${mon.id} ${mon.name}\n      ${diffs.join('\n      ')}`);
if (onlyWiki.length) {
  console.log(`\non the wiki but NOT in db.json (not added): ${onlyWiki.length}`);
  for (const w of onlyWiki) console.log(`  ${w.id} ${w.name} (lv ${w.level})`);
}
if (missingOnWiki.length) {
  console.log(`\nin db.json but NOT on the wiki (kept as is): ${missingOnWiki.length}`);
  for (const s of missingOnWiki) console.log(`  ${s}`);
}

if (!APPLY) {
  console.log('\nreport only — run again with --apply to write db.json');
} else if (changed.length) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const backup = join(BACKUP_DIR, `db-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  copyFileSync(DB, backup);
  db.generatedAt = new Date().toISOString();
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  writeFileSync(DB, JSON.stringify(db, null, 4).replace(/\n/g, eol) + eol);
  console.log(`\nwritten: ${DB}\nbackup: ${backup}`);
} else {
  console.log('\nnothing to write');
}
