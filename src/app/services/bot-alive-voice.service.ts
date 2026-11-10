import { Injectable, inject } from '@angular/core';
import { combineLatest } from 'rxjs';

import { RbBotService, bossKey } from './rb-bot.service';
import { JsonRb, RbJsonDataService } from './rb-json-data.service';
import { RespVoiceService } from './resp-voice.service';

/** a sighting older than this (late snapshot, sleeping laptop) is not news any more */
const MAX_LATE_MS = 10 * 60 * 1000;
/** localStorage prefix: another tab of this browser already said it */
const LS_SAID = 'rb-bot-alive-said:';

/**
 * 2 bells + «РБ <имя>» + a bell on every open page when the bot reports a boss
 * standing alive (a new `alive` suggestion). Only what the bot sends after the
 * page was opened is read out — nothing old after a reload or a login.
 */
@Injectable({ providedIn: 'root' })
export class BotAliveVoiceService {
  private bot = inject(RbBotService);
  private rbJsonData = inject(RbJsonDataService);
  private voice = inject(RespVoiceService);

  private started = false;
  private openedAt = 0;
  private seen = new Set<string>();

  start(): void {
    if (this.started) return;
    this.started = true;
    this.openedAt = Date.now();
    combineLatest([this.bot.suggestions$, this.rbJsonData.getRaidBosses()]).subscribe(([list, bosses]) => {
      const now = Date.now();
      for (const s of list) {
        if (s.event !== 'alive' || s.status !== 'new' || this.seen.has(s.id)) continue;
        this.seen.add(s.id);
        // a little slack for the bot's clock / a sighting sent a bit after it was seen;
        // a reload replaying it is stopped by claim()
        if (s.sentAt < this.openedAt - 2 * 60 * 1000 || now - s.at > MAX_LATE_MS) continue;
        if (!this.claim(s.id)) continue;
        const boss = this.match(bosses, s.bossId, s.bossName);
        const name = boss?.displayName || boss?.name || s.bossName || 'без имени';
        this.voice.announceAlive(`alive@${s.id}`, boss ? String(boss.id) : '', name);
      }
    });
  }

  private match(bosses: JsonRb[], id: string | null, name: string): JsonRb | null {
    if (id) {
      const byId = bosses.find((b) => String(b.id) === id);
      if (byId) return byId;
    }
    const key = bossKey(name);
    return (key && bosses.find((b) => bossKey(b.name) === key || bossKey(b.displayName) === key)) || null;
  }

  /** one announcement per browser, even with several tabs open */
  private claim(id: string): boolean {
    try {
      const k = LS_SAID + id;
      if (localStorage.getItem(k)) return false;
      localStorage.setItem(k, String(Date.now()));
      this.prune();
    } catch {
      /* no storage → every tab speaks */
    }
    return true;
  }

  private prune(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_SAID) && Number(localStorage.getItem(k)) < cutoff) localStorage.removeItem(k);
    }
  }
}
