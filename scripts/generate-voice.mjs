#!/usr/bin/env node
/**
 * Pre-renders the "РБ <имя> в респе" voice announcement pieces, so the site
 * plays the same voices for everyone instead of the browser's own TTS.
 *
 *   node scripts/generate-voice.mjs                  # render everything missing, all voices
 *   node scripts/generate-voice.mjs --voice=pudge    # only some voices (comma-separated keys)
 *   node scripts/generate-voice.mjs --sample         # a few phrases + bosses per voice
 *   node scripts/generate-voice.mjs --preview        # + glue one full announcement per voice
 *                                                    #   into .voice-preview/<voice>.mp3 to listen
 *   node scripts/generate-voice.mjs --dry            # just count clips, no synthesis
 *
 * Voices come from two providers:
 * - `local` — the VoxCPM TTS container (twitch-tts-master) at http://localhost/api/tts;
 *   its WAV is converted to MP3 (and trimmed) by ffmpeg inside the `tts-api-dev` container.
 * - `elevenlabs` — needs ELEVENLABS_API_KEY in `.env.voice` (gitignored).
 *
 * Sources: src/app/data/resp-phrases.ts (phrases), src/app/data/action-phrases.ts
 * (action lines), src/assets/data/db.json (boss names) + src/app/data/boss-voice-names.ts
 * (pronunciation overrides).
 * Output: src/assets/voice/<voice>/{fixed,phrases,bosses,actions}/*.mp3 + <voice>/manifest.json,
 * and src/assets/voice/voices.json (the list the site offers).
 *
 * File names carry a hash of voice + text, so a re-run only renders what's new
 * or changed; interrupted runs just continue. Unreferenced clips are deleted on
 * a full (non --sample) run of that voice.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/assets/voice');
const PREVIEW_DIR = join(ROOT, '.voice-preview');

/** the voices the site offers, in menu order — `key` is the folder name */
const VOICES = [
  { key: 'pudge', label: 'Пудж', provider: 'local', id: 'pudge_ru' },
  { key: 'tractor', label: 'Трактор', provider: 'local', id: 'tractor_ru' },
  { key: 'three-dog', label: 'Three Dog', provider: 'local', id: 'three_dog_2_en' },
  { key: 'lina', label: 'Лина', provider: 'local', id: 'lina_ru' },
  { key: 'dora', label: 'Дора', provider: 'local', id: 'dora_ru' },
  { key: 'glados', label: 'GLaDOS', provider: 'local', id: 'glados_ru' },
  { key: 'baya', label: 'Бая', provider: 'local', id: 'baya_ru' },
];

const GROUPS = ['fixed', 'phrases', 'bosses', 'actions'];
const LOCAL_API = 'http://localhost/api/tts';
const FFMPEG_CONTAINER = 'tts-api-dev';
const ELEVEN_MODEL = 'eleven_multilingual_v2';

/**
 * Fixed pieces. «РБ» / «респ» are spelled out: TTS engines like to expand
 * them as abbreviations («Республика Беларусь», «республика»).
 */
const FIXED = {
  intro: 'Эр-бэ',
  inResp: 'в респе.',
  inSecondResp: 'во втором респе.',
  enabled: 'Озвучка включена.',
  disabled: 'Озвучка выключена.',
};

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const SAMPLE = has('--sample');
const PREVIEW = has('--preview');
const DRY = has('--dry');
const ONLY = (argv.find((a) => a.startsWith('--voice=')) ?? '').slice(8).split(',').filter(Boolean);

// ---------------------------------------------------------------- sources

function readEnv() {
  const file = join(ROOT, '.env.voice');
  const env = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) env[m[1]] = m[2];
    }
  }
  return { elevenKey: env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY || '' };
}

/** string literals of the RESP_PHRASES array */
function readPhrases() {
  const src = readFileSync(join(ROOT, 'src/app/data/resp-phrases.ts'), 'utf8');
  const body = src.slice(src.indexOf('RESP_PHRASES'));
  const arr = body.slice(body.indexOf('['), body.indexOf('];') + 1);
  const out = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = re.exec(arr))) {
    const text = m[2].replace(/\\(.)/g, '$1').trim();
    if (text) out.push(text);
  }
  return [...new Set(out)];
}

/** VOICE_ACTIONS from action-phrases.ts — plain data, so Node imports the .ts directly */
async function readActions() {
  process.removeAllListeners('warning'); // "reparsing as ES module" noise for the .ts import
  const url = pathToFileURL(join(ROOT, 'src/app/data/action-phrases.ts')).href;
  const { VOICE_ACTIONS } = await import(url);
  return Object.entries(VOICE_ACTIONS ?? {}).map(([key, a]) => ({
    key,
    boss: (a.boss ?? '').trim(),
    phrases: [...new Set((a.phrases ?? []).map((p) => String(p).trim()).filter(Boolean))],
  }));
}

function readOverrides() {
  const src = readFileSync(join(ROOT, 'src/app/data/boss-voice-names.ts'), 'utf8');
  const out = {};
  const re = /^\s*['"]?(\w+)['"]?\s*:\s*(['"])((?:\\.|(?!\2)[^\\])*)\2/gm;
  let m;
  while ((m = re.exec(src))) out[m[1]] = m[3].replace(/\\(.)/g, '$1').trim();
  return out;
}

function readBosses() {
  const db = JSON.parse(readFileSync(join(ROOT, 'src/assets/data/db.json'), 'utf8'));
  const overrides = readOverrides();
  return (db.monsters ?? [])
    .filter((m) => m?.id != null && m?.name)
    .map((m) => ({ id: String(m.id), text: overrides[String(m.id)] || String(m.name).trim() }));
}

// ---------------------------------------------------------------- audio

function hash(voice, text) {
  return createHash('sha1').update(`${voice.provider}|${voice.id}|${text}`).digest('hex').slice(0, 10);
}

/** pipe audio through ffmpeg inside the TTS container: trim edge silence, → mono MP3 */
function toMp3(input) {
  return new Promise((resolve, reject) => {
    const trim =
      'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,' +
      'areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse';
    const p = spawn('docker', [
      'exec', '-i', FFMPEG_CONTAINER,
      'ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
      '-af', trim, '-ac', '1', '-ar', '44100', '-codec:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', 'pipe:1',
    ]);
    const chunks = [];
    let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 && chunks.length ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg failed: ${err.slice(0, 300)}`)),
    );
    p.stdin.end(input);
  });
}

async function localTts(voice, text) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const url = `${LOCAL_API}?voice=${encodeURIComponent(voice.id)}&format=wav&text=${encodeURIComponent(text)}`;
    try {
      const res = await fetch(url);
      if (res.ok) return toMp3(Buffer.from(await res.arrayBuffer()));
      if (attempt === 3) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      if (attempt === 3) throw e;
    }
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
}

async function elevenTts(voice, text, key) {
  if (!key) throw new Error('ELEVENLABS_API_KEY is empty in .env.voice');
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: ELEVEN_MODEL }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

async function checkLocal() {
  const res = await fetch('http://localhost/api/health').catch(() => null);
  if (!res?.ok) throw new Error('TTS container is not reachable at http://localhost/api/health — start Docker / twitch-tts-master');
}

/** glue clips into one MP3 (for --preview), via ffmpeg concat in the container */
async function glue(buffers) {
  // MP3 frames concatenate cleanly; re-encode once so the result is a tidy single file
  return toMp3(Buffer.concat(buffers));
}

// ---------------------------------------------------------------- main

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

async function main() {
  const { elevenKey } = readEnv();
  let phrases = readPhrases();
  let bosses = readBosses();
  let actions = await readActions();
  if (SAMPLE) {
    phrases = phrases.slice(0, 3);
    bosses = bosses.slice(0, 3);
    actions = actions.slice(0, 2);
  }
  const voices = VOICES.filter((v) => !ONLY.length || ONLY.includes(v.key));
  if (!voices.length) throw new Error(`no such voice: ${ONLY.join(', ')}. Known: ${VOICES.map((v) => v.key).join(', ')}`);
  if (!DRY && voices.some((v) => v.provider === 'local')) await checkLocal();

  const plan = voices.map((voice) => {
    const jobs = [
      ...Object.entries(FIXED).map(([id, text]) => ({ group: 'fixed', id, text })),
      ...phrases.map((text) => ({ group: 'phrases', id: text, text })),
      ...bosses.map((b) => ({ group: 'bosses', id: b.id, text: b.text })),
      ...actions.flatMap((a) => [
        ...(a.boss ? [{ group: 'actions', action: a.key, id: '#boss', text: a.boss }] : []),
        ...a.phrases.map((text) => ({ group: 'actions', action: a.key, id: text, text })),
      ]),
    ].map((j) => {
      const slug = j.group === 'phrases' ? '' : j.group === 'actions' ? `${j.action}-` : `${j.id}-`;
      return { ...j, file: `${j.group}/${slug}${hash(voice, j.text)}.mp3` };
    });
    const dir = join(OUT, voice.key);
    return { voice, dir, jobs, todo: jobs.filter((j) => !existsSync(join(dir, j.file))) };
  });

  const total = plan.reduce((s, p) => s + p.todo.length, 0);
  for (const p of plan) console.log(`${p.voice.key.padEnd(10)} ${p.jobs.length} clips, ${p.todo.length} to render`);
  console.log(`total to render: ${total}`);
  if (DRY) return;

  const started = Date.now();
  let done = 0;
  for (const p of plan) {
    for (const g of GROUPS) mkdirSync(join(p.dir, g), { recursive: true });
    for (const j of p.todo) {
      const audio =
        p.voice.provider === 'local' ? await localTts(p.voice, j.text) : await elevenTts(p.voice, j.text, elevenKey);
      writeFileSync(join(p.dir, j.file), audio);
      done++;
      const eta = ((Date.now() - started) / done) * (total - done);
      process.stdout.write(
        `\r  [${done}/${total}] ${p.voice.key}: ${j.text.slice(0, 32).padEnd(32)}  ~${fmtDuration(eta)} left   `,
      );
    }

    // manifest: only clips that actually exist on disk
    const have = (j) => existsSync(join(p.dir, j.file));
    const pick = (g) => Object.fromEntries(p.jobs.filter((j) => j.group === g && have(j)).map((j) => [j.id, j.file]));
    // actions: { kill: { boss: 'actions/kill-….mp3', phrases: { 'Помянем.': '…' } } }
    const actionMap = {};
    for (const j of p.jobs) {
      if (j.group !== 'actions' || !have(j)) continue;
      const a = (actionMap[j.action] ??= { phrases: {} });
      if (j.id === '#boss') a.boss = j.file;
      else a.phrases[j.id] = j.file;
    }
    writeFileSync(
      join(p.dir, 'manifest.json'),
      JSON.stringify({ voice: p.voice.key, label: p.voice.label, generatedAt: new Date().toISOString(), fixed: pick('fixed'), phrases: pick('phrases'), bosses: pick('bosses'), actions: actionMap }, null, 2) + '\n',
    );

    if (!SAMPLE) {
      const keep = new Set(p.jobs.map((j) => j.file));
      for (const g of GROUPS) {
        for (const f of readdirSync(join(p.dir, g))) if (f.endsWith('.mp3') && !keep.has(`${g}/${f}`)) unlinkSync(join(p.dir, g, f));
      }
    }

    if (PREVIEW) {
      const byId = Object.fromEntries(p.jobs.map((j) => [`${j.group}:${j.id}`, j]));
      const parts = [byId[`phrases:${phrases[0]}`], byId['fixed:intro'], byId[`bosses:${bosses[0].id}`], byId['fixed:inResp']]
        .filter((j) => j && have(j))
        .map((j) => readFileSync(join(p.dir, j.file)));
      mkdirSync(PREVIEW_DIR, { recursive: true });
      writeFileSync(join(PREVIEW_DIR, `${p.voice.key}.mp3`), await glue(parts));
    }
  }
  if (total) process.stdout.write('\n');

  // the list of voices the site offers: every voice folder that has a manifest
  const list = VOICES.filter((v) => existsSync(join(OUT, v.key, 'manifest.json'))).map((v) => ({ key: v.key, label: v.label }));
  writeFileSync(join(OUT, 'voices.json'), JSON.stringify(list, null, 2) + '\n');
  console.log(`done in ${fmtDuration(Date.now() - started)}. voices on the site: ${list.map((v) => v.label).join(', ')}`);
  if (PREVIEW) console.log(`previews: ${PREVIEW_DIR}`);
}

main().catch((e) => {
  console.error('\n' + (e?.message ?? e));
  process.exit(1);
});
