import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { TooltipModule } from 'primeng/tooltip';

import { JsonRb, RbJsonDataService } from '../../services/rb-json-data.service';
import { RbJsonRespService } from '../../services/rb-json-resp.service';
import { BotLiveStatus, BotQueueItem, BotSuggestion, RbBotService, bossKey } from '../../services/rb-bot.service';
import { NgMirrorService } from '../../services/ng-mirror.service';
import { SiteUsersService, actorLabel } from '../../services/site-users.service';

/** pending bot events for one boss (or one unmatched name) */
interface BotGroup {
  key: string;
  boss: JsonRb | null;
  name: string;
  /** every event, newest first */
  items: BotSuggestion[];
  /** latest «убит» — the one that goes to the resp */
  kill: BotSuggestion | null;
  /** latest «жив» */
  alive: BotSuggestion | null;
  /** newest event of any kind (sorting) */
  last: BotSuggestion;
  /** our current kill time (ms), null = none */
  ourMs: number | null;
}

/**
 * «Бот»: resp suggestions the clan bot posts to Firestore (see docs/bot-api.md).
 * Grouped per boss — accept one by one or in bulk into our kill times (which
 * also go to NG when «Дубль в NG» is on).
 */
@Component({
  selector: 'app-bot',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, CheckboxModule, ConfirmDialogModule, DialogModule, DropdownModule, TooltipModule],
  providers: [ConfirmationService],
  templateUrl: './bot.component.html',
  styleUrl: './bot.component.scss',
})
export class BotComponent {
  private bot = inject(RbBotService);
  private rbJsonData = inject(RbJsonDataService);
  private rbJsonResp = inject(RbJsonRespService);
  private messages = inject(MessageService);
  private confirm = inject(ConfirmationService);
  private siteUsers = inject(SiteUsersService);
  readonly ngMirror = inject(NgMirrorService);

  readonly suggestions = toSignal(this.bot.suggestions$, { initialValue: [] as BotSuggestion[] });

  /* ---------------------------------------------------------------- live status */
  /** heartbeat docs — pushed by Firestore on every update */
  readonly live = toSignal(this.bot.liveStatus$, { initialValue: [] as BotLiveStatus[] });
  /** clock for «N сек назад» / online-offline flips without a new heartbeat */
  readonly now = signal(Date.now());
  private readonly tick = interval(5000)
    .pipe(takeUntilDestroyed(inject(DestroyRef)))
    .subscribe(() => this.now.set(Date.now()));

  /** stale after 3 missed heartbeats (at least 90 s) */
  isOnline(st: BotLiveStatus): boolean {
    if (st.state === 'stopped' || !st.updatedAt) return false;
    return this.now() - st.updatedAt <= Math.max(90_000, st.intervalSec * 3000);
  }
  liveLabel(st: BotLiveStatus): string {
    if (st.state === 'stopped') return 'Остановлен';
    if (!this.isOnline(st)) return 'Нет связи';
    if (st.state === 'error') return 'Ошибка';
    return 'Работает';
  }
  stateLabel(state: string): string {
    const map: Record<string, string> = {
      idle: 'ждёт',
      moving: 'идёт к РБ',
      travel: 'идёт к РБ',
      waiting: 'ждёт респ',
      fighting: 'бьёт РБ',
      killing: 'бьёт РБ',
      looting: 'собирает дроп',
      dead: 'умер',
      stopped: 'остановлен',
      error: 'ошибка',
    };
    return map[state] ?? state;
  }
  /** «12 сек назад» / «3 мин назад» / «2 ч назад» */
  ago(ms: number): string {
    if (!ms) return 'никогда';
    const s = Math.max(0, Math.round((this.now() - ms) / 1000));
    if (s < 60) return `${s} сек назад`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} мин назад`;
    const h = Math.floor(m / 60);
    return h < 48 ? `${h} ч ${m % 60} мин назад` : this.fmt(ms);
  }
  /** «через 25 мин» / «сейчас» / time */
  eta(ms: number): string {
    if (!ms) return '';
    const d = Math.round((ms - this.now()) / 60_000);
    if (Math.abs(d) <= 1) return 'сейчас';
    if (d > 0 && d < 180) return `через ${d >= 60 ? Math.floor(d / 60) + ' ч ' : ''}${d % 60} мин`;
    return this.fmt(ms);
  }
  /** our catalogue entry for a name / id the bot reported (for the level) */
  bossOf(name: string, id: string | null = null): JsonRb | null {
    return (id && this.byId().get(id)) || this.byKey().get(bossKey(name)) || null;
  }
  queueTrack = (i: number, q: BotQueueItem) => `${i}:${q.bossName}`;
  /** bots whose whole «Дальше» queue is unfolded (by default only the next one shows) */
  readonly queueOpen = signal<Set<string>>(new Set());
  toggleQueue(id: string): void {
    const next = new Set(this.queueOpen());
    next.has(id) ? next.delete(id) : next.add(id);
    this.queueOpen.set(next);
  }
  readonly bosses = toSignal(this.rbJsonData.getRaidBosses(), { initialValue: [] as JsonRb[] });
  private readonly names = toSignal(this.siteUsers.namesByEmail$, { initialValue: new Map<string, string>() });

  readonly bossOptions = computed(() =>
    [...this.bosses()]
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
      .map((b) => ({ label: `[${b.level}] ${b.displayName || b.name}`, value: b.id })),
  );

  private readonly byId = computed(() => new Map(this.bosses().map((b) => [String(b.id), b])));
  private readonly byKey = computed(() => {
    const m = new Map<string, JsonRb>();
    for (const b of this.bosses()) {
      for (const n of [b.name, b.displayName]) {
        const k = bossKey(n);
        if (k && !m.has(k)) m.set(k, b);
      }
    }
    return m;
  });

  match(s: BotSuggestion): JsonRb | null {
    return (s.bossId && this.byId().get(s.bossId)) || this.byKey().get(bossKey(s.bossName)) || null;
  }

  /** pending events, one card per boss, most recent event first */
  readonly groups = computed<BotGroup[]>(() => {
    const map = new Map<string, BotGroup>();
    for (const s of this.suggestions()) {
      if (s.status !== 'new') continue;
      const boss = this.match(s);
      const key = boss ? `id:${boss.id}` : `raw:${bossKey(s.bossName)}`;
      let g = map.get(key);
      if (!g) {
        const ours = boss?.lastDeadTime ? boss.lastDeadTime.toMillis() : null;
        g = { key, boss, name: boss ? boss.displayName || boss.name : s.bossName || '(без имени)', items: [], kill: null, alive: null, last: s, ourMs: ours };
        map.set(key, g);
      }
      g.items.push(s);
      if (s.at > g.last.at) g.last = s;
      if (s.event === 'killed' && (!g.kill || s.at > g.kill.at)) g.kill = s;
      if (s.event === 'alive' && (!g.alive || s.at > g.alive.at)) g.alive = s;
    }
    return [...map.values()]
      .map((g) => ({ ...g, items: g.items.sort((a, b) => b.at - a.at) }))
      .sort((a, b) => b.last.at - a.last.at);
  });

  /** the latest thing the bot saw is «жив» — it's standing right now */
  aliveNow(g: BotGroup): boolean {
    return !!g.alive && (!g.kill || g.alive.at > g.kill.at);
  }
  readonly aliveCount = computed(() => this.groups().filter((g) => this.aliveNow(g)).length);
  readonly killCount = computed(() => this.groups().filter((g) => !!g.kill).length);

  readonly newCount = computed(() => this.groups().reduce((s, g) => s + g.items.length, 0));
  readonly handled = computed(() => this.suggestions().filter((s) => s.status !== 'new').sort((a, b) => (b.handledAt ?? 0) - (a.handledAt ?? 0)));

  // ---------------------------------------------------------------- ui state
  readonly onlyNewer = signal(false);
  readonly overwriteNewer = signal(false);
  readonly selected = signal<Set<string>>(new Set());
  readonly expanded = signal<Set<string>>(new Set());
  readonly showHandled = signal(false);
  readonly busy = signal(false);

  readonly visibleGroups = computed(() =>
    this.onlyNewer() ? this.groups().filter((g) => this.isNewer(g)) : this.groups(),
  );
  readonly selectableKeys = computed(() => this.visibleGroups().filter((g) => g.boss && g.kill).map((g) => g.key));
  readonly selectedCount = computed(() => this.selectableKeys().filter((k) => this.selected().has(k)).length);
  readonly allSelected = computed(() => {
    const keys = this.selectableKeys();
    return keys.length > 0 && keys.every((k) => this.selected().has(k));
  });

  /** has a kill that's newer than ours */
  isNewer(g: BotGroup): boolean {
    return !!g.kill && (g.ourMs == null || g.kill.at > g.ourMs);
  }
  toggleSelect(key: string): void {
    const next = new Set(this.selected());
    next.has(key) ? next.delete(key) : next.add(key);
    this.selected.set(next);
  }
  toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.selectableKeys()));
  }
  toggleExpanded(key: string): void {
    const next = new Set(this.expanded());
    next.has(key) ? next.delete(key) : next.add(key);
    this.expanded.set(next);
  }

  // ---------------------------------------------------------------- formatting
  fmt(ms: number | null): string {
    if (!ms) return '—';
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  /** «новее на 2 ч 15 м» / «старше на 40 м» / «то же время» */
  diff(g: BotGroup, killedAt = g.kill?.at ?? 0): string {
    if (g.ourMs == null) return 'у нас времени нет';
    const d = killedAt - g.ourMs;
    if (Math.abs(d) < 60_000) return 'то же время';
    const m = Math.round(Math.abs(d) / 60_000);
    const txt = m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} м` : `${m} м`;
    return d > 0 ? `новее нашего на ${txt}` : `старше нашего на ${txt}`;
  }
  who(email: string): string {
    return actorLabel(email, this.names());
  }

  // ---------------------------------------------------------------- actions
  private async write(g: BotGroup, s: BotSuggestion): Promise<void> {
    const boss = g.boss!;
    await this.rbJsonResp.setKillTime(String(boss.id), new Date(s.at), { bossName: boss.displayName || boss.name });
    await this.bot.setStatus(g.items.map((x) => x.id), 'applied');
  }

  /** one boss: its latest (or a specific) «убит» → our kill time */
  apply(g: BotGroup, s: BotSuggestion | null = g.kill): void {
    if (!g.boss || !s || s.event !== 'killed' || this.busy()) return;
    const run = async () => {
      this.busy.set(true);
      try {
        await this.write(g, s);
        this.toast('success', 'Перенесено в респ', `${g.name}: ${this.fmt(s.at)}`);
      } catch (e) {
        this.toast('error', 'Ошибка', this.msg(e));
      } finally {
        this.busy.set(false);
      }
    };
    if (g.ourMs != null && s.at <= g.ourMs) {
      this.confirm.confirm({
        header: 'Наше время свежее',
        message: `У нас ${this.fmt(g.ourMs)}, у бота ${this.fmt(s.at)} (${this.diff(g, s.at)}). Всё равно заменить?`,
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Заменить',
        rejectLabel: 'Отмена',
        accept: () => void run(),
      });
    } else {
      void run();
    }
  }

  /** selected bosses → their latest suggestion; ours-is-newer ones skipped unless asked */
  applySelected(): void {
    const groups = this.visibleGroups().filter((g) => g.boss && g.kill && this.selected().has(g.key));
    if (!groups.length || this.busy()) return;
    const overwrite = this.overwriteNewer();
    const todo = overwrite ? groups : groups.filter((g) => this.isNewer(g));
    const skipped = groups.length - todo.length;
    this.confirm.confirm({
      header: 'Перенести в респы',
      message:
        `Перенести ${todo.length} РБ в наши респы${this.ngMirror.enabled() ? ' (и в NG — «Дубль в NG» включён)' : ''}?` +
        (skipped ? ` ${skipped} пропустим — у нас время свежее.` : ''),
      icon: 'pi pi-sync',
      acceptLabel: 'Перенести',
      rejectLabel: 'Отмена',
      accept: async () => {
        this.busy.set(true);
        let done = 0;
        let failed = 0;
        for (const g of todo) {
          try {
            await this.write(g, g.kill!);
            done++;
          } catch {
            failed++;
          }
        }
        this.busy.set(false);
        this.selected.set(new Set());
        this.toast(failed ? 'warn' : 'success', `Перенесено: ${done}`, [skipped ? `пропущено: ${skipped}` : '', failed ? `ошибок: ${failed}` : ''].filter(Boolean).join(', '));
      },
    });
  }

  /** drop every event of this RB (with screenshots) */
  removeGroup(g: BotGroup): void {
    this.confirm.confirm({
      header: 'Удалить',
      message: `Удалить ${g.items.length} ${g.items.length === 1 ? 'событие' : 'событий'} по «${g.name}» вместе со скриншотами?`,
      icon: 'pi pi-trash',
      acceptLabel: 'Удалить',
      rejectLabel: 'Отмена',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => void this.bot.remove(g.items.map((x) => x.id)).catch((e) => this.toast('error', 'Ошибка', this.msg(e))),
    });
  }
  removeOne(s: BotSuggestion): void {
    void this.bot.remove([s.id]).catch((e) => this.toast('error', 'Ошибка', this.msg(e)));
  }
  reopen(s: BotSuggestion): void {
    void this.bot.reopen(s.id).catch((e) => this.toast('error', 'Ошибка', this.msg(e)));
  }

  /** unmatched name → pick the boss by hand (saved on the suggestions) */
  assignBoss(g: BotGroup, bossId: string | null): void {
    if (!bossId) return;
    void this.bot.setBossId(g.items.map((x) => x.id), String(bossId)).catch((e) => this.toast('error', 'Ошибка', this.msg(e)));
  }

  clearHandled(): void {
    const ids = this.handled().map((s) => s.id);
    if (!ids.length) return;
    this.confirm.confirm({
      header: 'Удалить обработанные',
      message: `Удалить ${ids.length} обработанных предложений вместе со скриншотами?`,
      icon: 'pi pi-trash',
      acceptLabel: 'Удалить',
      rejectLabel: 'Отмена',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => void this.bot.remove(ids).catch((e) => this.toast('error', 'Ошибка', this.msg(e))),
    });
  }

  // ---------------------------------------------------------------- screenshot
  readonly photoUrl = signal<string | null>(null);
  readonly photoTitle = signal('');
  readonly photoLoading = signal(false);
  async openPhoto(s: BotSuggestion, title: string): Promise<void> {
    this.photoTitle.set(`${title} · ${s.event === 'alive' ? 'жив' : 'убит'} · ${this.fmt(s.at)}`);
    this.photoUrl.set('');
    this.photoLoading.set(true);
    try {
      const url = await this.bot.photo(s.id);
      if (!url) {
        this.photoUrl.set(null);
        this.toast('warn', 'Скриншота нет', '');
        return;
      }
      this.photoUrl.set(url);
    } catch (e) {
      this.photoUrl.set(null);
      this.toast('error', 'Не удалось загрузить скриншот', this.msg(e));
    } finally {
      this.photoLoading.set(false);
    }
  }
  closePhoto(): void {
    this.photoUrl.set(null);
  }

  private toast(severity: string, summary: string, detail: string): void {
    this.messages.add({ severity, summary, detail, life: 4000 });
  }
  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e ?? '');
  }

  trackGroup = (_: number, g: BotGroup) => g.key;
  trackItem = (_: number, s: BotSuggestion) => s.id;
}
