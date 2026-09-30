import { Injectable, signal } from '@angular/core';

import { RESP_PHRASES } from '../data/resp-phrases';

const LS_ENABLED = 'rb-resp-voice';

/**
 * Speech engines expand "респ" as the abbreviation of «республика» ("вошел в
 * республику"). Spelling it «рэсп» sounds the same but isn't a known
 * abbreviation. Applied to the whole text, incl. the phrases file.
 */
function forSpeech(text: string): string {
  return text.replace(/(^|[^а-яё])(р)есп/gi, (_m, pre: string, r: string) => `${pre}${r}эсп`);
}

/**
 * Speaks "<random phrase>. Однако РБ <name> в респе" through the browser's
 * built-in speech synthesis. Per-browser on/off switch in localStorage (on by
 * default). Dedupes by boss + window start, so the same entry is never announced
 * twice even if the boss is on screen in more than one card.
 *
 * Browsers only let a page speak after the user has interacted with it at least
 * once (a click / key press) — before that `speak()` is silently ignored.
 */
@Injectable({ providedIn: 'root' })
export class RespVoiceService {
  readonly enabled = signal(this.readEnabled());
  private announced = new Set<string>();

  get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  toggle(): void {
    const next = !this.enabled();
    this.enabled.set(next);
    try {
      localStorage.setItem(LS_ENABLED, next ? '1' : '0');
    } catch {
      /* ignore */
    }
    // the click itself counts as the user interaction that unlocks speech
    this.speak(next ? 'Озвучка включена' : 'Озвучка выключена');
  }

  /**
   * @param key       unique per boss + resp window (e.g. `${id}@${windowStartMs}`)
   * @param bossName  spoken as is
   * @param second    true for the 2nd resp window
   */
  announce(key: string, bossName: string, second = false): void {
    if (!this.enabled() || this.announced.has(key)) return;
    this.announced.add(key);
    const phrase = RESP_PHRASES.length
      ? RESP_PHRASES[Math.floor(Math.random() * RESP_PHRASES.length)]
      : '';
    const tail = `Однако РБ ${bossName} ${second ? 'во втором респе' : 'в респе'}.`;
    this.speak(phrase ? `${phrase} ${tail}` : tail);
  }

  private speak(text: string): void {
    if (!this.supported) return;
    const u = new SpeechSynthesisUtterance(forSpeech(text));
    u.lang = 'ru-RU';
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('ru'));
    if (voice) u.voice = voice;
    // speechSynthesis queues utterances itself, so several bosses at once are read one by one
    window.speechSynthesis.speak(u);
  }

  private readEnabled(): boolean {
    try {
      return localStorage.getItem(LS_ENABLED) !== '0';
    } catch {
      return true;
    }
  }
}
