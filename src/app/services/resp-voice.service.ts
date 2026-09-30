import { Injectable, computed, signal } from '@angular/core';

import { RESP_PHRASES } from '../data/resp-phrases';
import { VOICE_ACTIONS, VoiceAction, VoiceActionKey } from '../data/action-phrases';
import { RbStatus } from '../constants/status';
import { calculateStatus } from '../utils/rb-enrich';

const LS_ENABLED = 'rb-resp-voice';
const LS_ALL_TABS = 'rb-resp-voice-all';
const LS_ACTIONS = 'rb-voice-actions';
/** localStorage: the picked voice set key; absent / unknown = the first one */
const LS_VOICE_SET = 'rb-resp-voice-set';

/** where scripts/generate-voice.mjs puts the pre-rendered voices (absolute: routes are nested) */
const VOICE_ROOT = '/assets/voice/';
/** short breath between glued clips */
const CLIP_GAP_MS = 120;
/** the same action fired again this soon (bulk edits, double clicks) stays quiet */
const ACTION_REPEAT_MS = 2000;
/** a late tick (background tab, sleeping laptop) still announces, but not hours-old news */
const ANNOUNCE_MAX_LATE_MS = 10 * 60 * 1000;

function readStr(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeStr(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * Speech engines expand "респ" as the abbreviation of «республика». Spelling it
 * «рэсп» sounds the same but isn't a known abbreviation. Only matters for the
 * browser-voice fallback.
 */
function forSpeech(text: string): string {
  return text.replace(/(^|[^а-яё])(р)есп/gi, (_m, pre: string, r: string) => `${pre}${r}эсп`);
}

interface VoiceManifest {
  fixed: Record<string, string>;
  phrases: Record<string, string>;
  bosses: Record<string, string>;
  actions?: Record<string, { boss?: string; phrases: Record<string, string> }>;
}

export interface VoiceSet {
  key: string;
  label: string;
}

/** one piece of an announcement: a pre-rendered clip, or text for the browser voice */
interface Step {
  url?: string;
  text: string;
}

/**
 * The site's voice (settings live in the header's «Озвучка» popover):
 * - «РБ <имя> в респе» — fired by RespVoiceWatcher on the bookmarks pages;
 * - short joke lines for user actions (`action()`), texts in data/action-phrases.ts.
 *
 * Voices are pre-rendered sets (Пудж, GLaDOS, …) listed in `assets/voice/voices.json`,
 * made by scripts/generate-voice.mjs — the same voice for everyone who picks it.
 * A clip that's missing (new boss / new line not rendered yet) is read by the
 * browser's own voice for just that piece.
 *
 * Per-browser switches in localStorage: resp announcements (on by default),
 * "все закладки" (on by default; off = only the open bookmark), actions (on by default).
 * Everything is queued, so several announcements are read one after another.
 *
 * Browsers only let a page make sound after the user has interacted with it at
 * least once (a click / key press) — before that playback is silently refused.
 */
@Injectable({ providedIn: 'root' })
export class RespVoiceService {
  /** «РБ … в респе» announcements */
  readonly enabled = signal(readFlag(LS_ENABLED, true));
  /** watch every bookmark, not just the open one */
  readonly allTabs = signal(readFlag(LS_ALL_TABS, true));
  /** joke lines on user actions */
  readonly actionsEnabled = signal(readFlag(LS_ACTIONS, true));
  private announced = new Set<string>();
  private lastAction = new Map<string, number>();

  /** pre-rendered voice sets available on the site */
  readonly voiceSets = signal<VoiceSet[]>([]);
  private readonly pickedSet = signal(readStr(LS_VOICE_SET, ''));
  /** the set in use: the picked one, or the first available */
  readonly voiceSet = computed(() => {
    const sets = this.voiceSets();
    const picked = this.pickedSet();
    return sets.some((v) => v.key === picked) ? picked : (sets[0]?.key ?? '');
  });
  private readonly manifests = signal<Record<string, VoiceManifest>>({});
  private readonly manifest = computed<VoiceManifest | null>(() => this.manifests()[this.voiceSet()] ?? null);

  private queue: Promise<void> = Promise.resolve();

  constructor() {
    void fetch(`${VOICE_ROOT}voices.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        this.voiceSets.set(Array.isArray(list) ? list : []);
        void this.loadManifest(this.voiceSet());
      })
      .catch(() => null);
  }

  get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  // ---------------------------------------------------------------- settings

  setEnabled(next: boolean): void {
    this.enabled.set(next);
    writeFlag(LS_ENABLED, next);
    this.sayToggled(next);
  }

  /** «Озвучка включена / выключена» — the click itself is the user gesture that unlocks sound */
  private sayToggled(on: boolean): void {
    this.play([this.fixedStep(on ? 'enabled' : 'disabled', on ? 'Озвучка включена' : 'Озвучка выключена')], true);
  }
  setAllTabs(next: boolean): void {
    this.allTabs.set(next);
    writeFlag(LS_ALL_TABS, next);
  }
  setActionsEnabled(next: boolean): void {
    this.actionsEnabled.set(next);
    writeFlag(LS_ACTIONS, next);
    this.sayToggled(next);
  }

  /** pick a voice set — silently; «Прослушать» plays the sample */
  setVoiceSet(key: string): void {
    this.pickedSet.set(key);
    writeStr(LS_VOICE_SET, key);
    void this.loadManifest(key);
  }

  private async loadManifest(key: string): Promise<VoiceManifest | null> {
    if (!key) return null;
    const have = this.manifests()[key];
    if (have) return have;
    try {
      const r = await fetch(`${VOICE_ROOT}${key}/manifest.json`, { cache: 'no-cache' });
      const m = r.ok ? await r.json() : null;
      if (m?.fixed) {
        this.manifests.update((all) => ({ ...all, [key]: m as VoiceManifest }));
        return m as VoiceManifest;
      }
    } catch {
      /* missing pieces fall back to the browser voice */
    }
    return null;
  }

  private url(file: string | undefined): string | undefined {
    return file ? `${VOICE_ROOT}${this.voiceSet()}/${file}` : undefined;
  }

  // ---------------------------------------------------------------- speaking

  /** «Прослушать»: a sample announcement in the picked voice (cancels whatever is playing) */
  async preview(): Promise<void> {
    const m = await this.loadManifest(this.voiceSet());
    const bosses = Object.keys(m?.bosses ?? {});
    const bossId = bosses.length ? bosses[Math.floor(Math.random() * bosses.length)] : '';
    this.play(this.announcementSteps(bossId, 'Анаким', false), true);
  }

  /**
   * @param key       unique per boss + resp window (e.g. `${id}@${windowStartMs}`)
   * @param bossId    catalogue id — picks the pre-rendered name clip
   * @param bossName  spoken by the browser voice when there's no clip
   * @param second    true for the 2nd resp window
   */
  announce(key: string, bossId: string, bossName: string, second = false): void {
    if (!this.enabled() || this.announced.has(key)) return;
    this.announced.add(key);
    this.play(this.announcementSteps(bossId, bossName, second));
  }

  /**
   * A joke line for a user action (see data/action-phrases.ts): the optional
   * `lead` («время убийства поправлено.»), then a random phrase. Never says the
   * boss name — `_boss` is accepted only so call sites can keep passing it.
   */
  action(key: VoiceActionKey, _boss?: { id?: string | number | null; name?: string | null }): void {
    if (!this.actionsEnabled()) return;
    const now = Date.now();
    if (now - (this.lastAction.get(key) ?? 0) < ACTION_REPEAT_MS) return;
    this.lastAction.set(key, now);

    const def: VoiceAction = VOICE_ACTIONS[key];
    const m = this.manifest();
    const clips = m?.actions?.[key];
    const steps: Step[] = [];
    if (def.lead) steps.push({ url: this.url(clips?.boss), text: def.lead });
    const phrase = pick(def.phrases);
    if (phrase) steps.push({ url: this.url(clips?.phrases?.[phrase]), text: phrase });
    if (steps.length) this.play(steps);
  }

  private announcementSteps(bossId: string, bossName: string, second: boolean): Step[] {
    const m = this.manifest();
    const tail = second ? 'во втором респе' : 'в респе';
    if (!m) {
      const phrase = pick(RESP_PHRASES) ?? '';
      return [{ text: `${phrase} РБ ${bossName} ${tail}.`.trim() }];
    }
    // only phrases that were actually rendered, so the whole line is one voice
    const rendered = RESP_PHRASES.filter((p) => m.phrases[p]);
    const phrase = pick(rendered.length ? rendered : RESP_PHRASES);
    const bossFile = m.bosses[String(bossId)];
    return [
      ...(phrase ? [{ url: this.url(m.phrases[phrase]), text: phrase }] : []),
      this.fixedStep('intro', 'РБ'),
      { url: this.url(bossFile), text: bossName },
      this.fixedStep(second ? 'inSecondResp' : 'inResp', `${tail}.`),
    ];
  }

  private fixedStep(key: string, text: string): Step {
    return { url: this.url(this.manifest()?.fixed?.[key]), text };
  }

  /** queue steps after whatever is already playing; `interrupt` drops the queue first */
  private play(steps: Step[], interrupt = false): void {
    if (interrupt) {
      this.stopAll();
      this.queue = Promise.resolve();
    }
    this.queue = this.queue.then(() => this.playSteps(steps)).catch(() => undefined);
  }

  private current: HTMLAudioElement | null = null;
  private stopAll(): void {
    this.current?.pause();
    this.current = null;
    if (this.supported) window.speechSynthesis.cancel();
  }

  private async playSteps(steps: Step[]): Promise<void> {
    for (const s of steps) {
      if (s.url) {
        const ok = await this.playAudio(s.url);
        if (!ok) await this.speakAsync(s.text); // clip missing / blocked → browser voice
      } else {
        await this.speakAsync(s.text);
      }
      await new Promise((r) => setTimeout(r, CLIP_GAP_MS));
    }
  }

  private playAudio(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const a = new Audio(url);
      this.current = a;
      a.onended = () => resolve(true);
      a.onerror = () => resolve(false);
      a.play().catch(() => resolve(false));
    });
  }

  /** fallback for pieces that have no clip yet: the first Russian browser voice */
  private speakAsync(text: string): Promise<void> {
    if (!this.supported || !text.trim()) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(forSpeech(text));
      u.lang = 'ru-RU';
      const voice = window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('ru'));
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }
}

function pick<T>(list: readonly T[]): T | undefined {
  return list.length ? list[Math.floor(Math.random() * list.length)] : undefined;
}

/** what a page hands the watcher each tick — an enriched raid-boss item */
export interface VoiceWatchItem {
  id: string;
  displayName?: string;
  name?: string;
  hidden?: boolean;
  minResp?: Date | null;
  maxResp?: Date | null;
  secondMinResp?: Date | null;
  secondMaxResp?: Date | null;
}

/**
 * Page-level "entered resp" detector (one per bookmarks page). Fed the bosses
 * to watch on every tick; announces on a status TRANSITION:
 * not-in-resp / soon → в респе, or 1st passed / soon 2nd → во втором респе.
 *
 * Transition-based on purpose: background tabs throttle timers to about once a
 * minute, so matching the exact first second would almost never fire there.
 * A boss seen for the first time (page just opened, just added to the watched
 * set) only records a baseline; an edited kill time resets it too.
 */
export class RespVoiceWatcher {
  private prev = new Map<string, { status: RbStatus; minMs: number | null }>();

  constructor(private voice: RespVoiceService) {}

  check(items: VoiceWatchItem[], now: number): void {
    const seen = new Set<string>();
    for (const rb of items) {
      if (!rb?.id) continue;
      seen.add(rb.id);
      const status = calculateStatus(rb.minResp ?? null, rb.maxResp ?? null, rb.secondMinResp ?? null, rb.secondMaxResp ?? null, now);
      const minMs = rb.minResp instanceof Date ? rb.minResp.getTime() : null;
      const before = this.prev.get(rb.id);
      this.prev.set(rb.id, { status, minMs });
      if (!before || before.minMs !== minMs || rb.hidden) continue;

      const first =
        status === RbStatus.InResp &&
        (before.status === RbStatus.NotInResp || before.status === RbStatus.SoonResp);
      const second =
        status === RbStatus.SecondResp &&
        (before.status === RbStatus.FirstRespPassed || before.status === RbStatus.SoonSecondResp);
      if (!first && !second) continue;

      const start = first ? rb.minResp : rb.secondMinResp;
      const startMs = start instanceof Date ? start.getTime() : null;
      if (startMs == null || now - startMs > ANNOUNCE_MAX_LATE_MS) continue;

      const name = String(rb.displayName ?? rb.name ?? '').trim() || 'без имени';
      this.voice.announce(`${rb.id}@${startMs}`, String(rb.id), name, second);
    }
    // dropped from the watched set → forget, so coming back starts from a fresh baseline
    for (const id of this.prev.keys()) if (!seen.has(id)) this.prev.delete(id);
  }
}
