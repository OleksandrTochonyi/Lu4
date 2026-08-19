import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { timer } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { PopoverModule } from 'primeng/popover';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import { JsonRb } from '../../../services/rb-json-data.service';
import { RespHistoryEntry } from '../../../services/rb-json-resp.service';
import { RbStatus } from '../../../constants/status';
import { TgService } from '../../../services/tg.service';
import { calculateStatus } from '../../../utils/rb-enrich';

const SITE_URL = 'https://lu4-serv.web.app';
import { GradeBadgeComponent } from '../grade-badge/grade-badge.component';
import { ChanceBadgeComponent } from '../chance-badge/chance-badge.component';
import { BossStatsComponent } from '../boss-stats/boss-stats.component';

// Presentational card for a raid boss sourced from db.json. Expects `rb` to already be
// enriched (via utils/rb-json-enrich.ts's enrichJsonRb) with deadTime/minResp/maxResp/
// secondMinResp/secondMaxResp/status — the resp math itself lives in utils/rb-enrich.ts,
// shared with the old Home/Bookmarks pages so behavior matches exactly. Shared between
// the Home-new and Bookmarks-new pages for the "name + level + loot + resp" row pattern.
@Component({
  selector: 'app-json-rb-card',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DatePickerModule, TagModule, PopoverModule, TooltipModule, GradeBadgeComponent, ChanceBadgeComponent, BossStatsComponent],
  templateUrl: './json-rb-card.component.html',
  styleUrl: './json-rb-card.component.scss',
})
export class JsonRbCardComponent implements OnInit {
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private tgService = inject(TgService);

  rb = input<(JsonRb & { hidden?: boolean; deadTime?: Date | null; minResp?: Date | null; maxResp?: Date | null; secondMinResp?: Date | null; secondMaxResp?: Date | null; status?: RbStatus }) | null>(null);
  showDeleteButton = input(false);

  toggleHidden = output<any>();
  removeFromList = output<any>();
  deadTimeDraftChanged = output<{ rb: any; deadTime: Date | null }>();
  deadTimeChanged = output<{ rb: any; deadTime: Date | null }>();

  deadTime: Date | null = null;
  private lastCommittedMs: number | null = null;
  private now = signal(Date.now());

  private lastMinRespMs: number | null = null;
  private lastSecondMinRespMs: number | null = null;
  private notifiedFirstRespStart = false;
  private notifiedSecondRespStart = false;

  onToggleHidden(): void {
    this.toggleHidden.emit(this.rb());
  }

  onRemoveFromList(): void {
    this.removeFromList.emit(this.rb());
  }

  hasMapPoint = computed<boolean>(() => {
    const rb = this.rb();
    return typeof rb?.mapX === 'number' && typeof rb?.mapY === 'number';
  });

  openOnMap(): void {
    const id = this.rb()?.id;
    if (!id) return;
    this.router.navigate(['/rb-map-new'], { queryParams: { focus: id } });
  }

  private readonly respColorSteps = [4, 5, 6, 7, 8, 9, 10];

  respBadgeClass(respValue: number | null | undefined): string {
    const value = Math.round(Number(respValue));
    return this.respColorSteps.includes(value) ? `resp-${value}` : 'resp-other';
  }

  // ---------- Live status (ticks every second against the fixed resp-window Dates) ----------

  // rb().status is a one-time snapshot computed by enrichJsonRb whenever the parent's
  // item list was last rebuilt (i.e. on a Firestore emission) — it does NOT advance on
  // its own as time passes. Recomputing it here against this.now() every second is what
  // actually makes the tag/background/countdown transition live (SoonResp -> InResp -> …)
  // instead of freezing once the real time passes the stale status's target.
  status = computed<RbStatus>(() => {
    const rb = this.rb();
    if (!rb) return RbStatus.Unknown;
    return calculateStatus(rb.minResp ?? null, rb.maxResp ?? null, rb.secondMinResp ?? null, rb.secondMaxResp ?? null, this.now());
  });

  tagSeverity = computed<'secondary' | 'success' | 'info' | 'warn' | 'danger' | 'contrast'>(() => {
    switch (this.status()) {
      case RbStatus.NotInResp:
        return 'info';
      case RbStatus.InResp:
      case RbStatus.SecondResp:
        return 'success';
      case RbStatus.FirstRespPassed:
        return 'danger';
      case RbStatus.Missed:
        return 'contrast';
      case RbStatus.SoonResp:
      case RbStatus.SoonSecondResp:
        return 'warn';
      default:
        return 'secondary';
    }
  });

  rowStatusClass = computed<string>(() => {
    switch (this.status()) {
      case RbStatus.NotInResp:
        return 'rb-bg-default';
      case RbStatus.Missed:
        return 'rb-bg-missed';
      case RbStatus.InResp:
      case RbStatus.SecondResp:
        return 'rb-bg-success';
      case RbStatus.FirstRespPassed:
        return 'rb-bg-danger';
      case RbStatus.SoonResp:
      case RbStatus.SoonSecondResp:
        return 'rb-bg-warn';
      default:
        return 'rb-bg-secondary';
    }
  });

  private isSecondRespWindow = computed(() => {
    const s = this.status();
    return s === RbStatus.FirstRespPassed || s === RbStatus.SecondResp;
  });

  displayMinResp = computed<Date | null>(() => {
    const rb = this.rb();
    if (!rb) return null;
    return this.isSecondRespWindow() ? rb.secondMinResp ?? null : rb.minResp ?? null;
  });

  displayMaxResp = computed<Date | null>(() => {
    const rb = this.rb();
    if (!rb) return null;
    return this.isSecondRespWindow() ? rb.secondMaxResp ?? null : rb.maxResp ?? null;
  });

  timeLeftLabel = computed<string>(() => {
    switch (this.status()) {
      case RbStatus.Missed:
        return 'Ну вот.. все проебали';
      case RbStatus.InResp:
        return 'В респе уже';
      case RbStatus.FirstRespPassed:
        return 'До 2-го мин. респа';
      case RbStatus.SecondResp:
        return 'Во 2м респе уже';
      case RbStatus.SoonResp:
        return 'Первый респ через';
      case RbStatus.SoonSecondResp:
        return 'Второй респ через';
      default:
        return 'До мин. респа';
    }
  });

  private respStart = computed<Date | null>(() => {
    const rb = this.rb();
    if (!rb) return null;
    const s = this.status();
    if (s === RbStatus.InResp) return rb.minResp ?? null;
    if (s === RbStatus.SecondResp) return rb.secondMinResp ?? null;
    return null;
  });

  respElapsedLabel = computed<string | null>(() => {
    const start = this.respStart();
    if (!start) return null;
    const diffMs = Math.max(0, this.now() - start.getTime());
    const totalMinutes = Math.floor(diffMs / (60 * 1000));
    if (totalMinutes < 60) return `${totalMinutes} ${this.pluralizeRu(totalMinutes, 'минута', 'минуты', 'минут')}`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const hoursLabel = `${hours} ${this.pluralizeRu(hours, 'час', 'часа', 'часов')}`;
    if (minutes === 0) return hoursLabel;
    return `${hoursLabel} ${minutes} ${this.pluralizeRu(minutes, 'минута', 'минуты', 'минут')}`;
  });

  private timeLeftTarget = computed<Date | null>(() => {
    const rb = this.rb();
    if (!rb) return null;
    switch (this.status()) {
      case RbStatus.Missed:
        return null;
      case RbStatus.InResp:
        return rb.maxResp ?? null;
      case RbStatus.FirstRespPassed:
        return rb.secondMinResp ?? null;
      case RbStatus.SecondResp:
        return this.addHours(rb.secondMaxResp ?? null, rb?.stats?.plusResp);
      case RbStatus.SoonResp:
        return rb.minResp ?? null;
      case RbStatus.SoonSecondResp:
        return rb.secondMinResp ?? null;
      default:
        return rb.minResp ?? null;
    }
  });

  timeLeft = computed<Date | null>(() => {
    const nowMs = this.now();
    const target = this.timeLeftTarget();
    if (!target) return null;
    return this.durationMsAsLocalTimeDate(Math.max(0, target.getTime() - nowMs));
  });

  respHistory = computed<RespHistoryEntry[]>(() => this.rb()?.respHistory ?? []);

  // Quick plain-text preview shown on hover (via pTooltip) — the interactive
  // restore-with-confirmation list lives in the click-to-open popover instead,
  // since a hover tooltip disappears the moment the pointer leaves it.
  historyTooltip = computed<string>(() => {
    const entries = this.respHistory();
    if (!entries.length) return '';
    return entries
      .map((e) => {
        const time = e.killTime ? this.toDate(e.killTime) : null;
        const timeLabel = time ? this.formatRuDateTime(time) : '—';
        return `${timeLabel} (${e.changedBy || 'кто-то'})`;
      })
      .join(' • ');
  });

  pendingRestoreIndex = signal<number | null>(null);

  askRestore(index: number): void {
    this.pendingRestoreIndex.set(index);
  }

  cancelRestore(): void {
    this.pendingRestoreIndex.set(null);
  }

  confirmRestore(index: number): void {
    const entry = this.respHistory()[index];
    this.pendingRestoreIndex.set(null);
    if (!entry) return;

    this.deadTime = entry.killTime ? this.toDate(entry.killTime) : null;
    this.commitDeadTime();
  }

  ngOnInit(): void {
    timer(0, 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));
  }

  constructor() {
    effect(() => {
      const rb = this.rb();
      const committed = rb?.deadTime ?? null;
      this.deadTime = committed;
      this.lastCommittedMs = committed ? committed.getTime() : null;
    });

    // Fires a Telegram notification the instant this row's resp window opens (first
    // or second window) — reset whenever the target time itself changes (kill time
    // edited/updated), and re-armed per window so it only fires once per entry.
    effect(() => {
      const rb = this.rb();
      const minResp = rb?.minResp ?? null;
      const secondMinResp = rb?.secondMinResp ?? null;

      const minMs = minResp instanceof Date ? minResp.getTime() : null;
      const secondMinMs = secondMinResp instanceof Date ? secondMinResp.getTime() : null;

      if (minMs !== this.lastMinRespMs) {
        this.lastMinRespMs = minMs;
        this.notifiedFirstRespStart = false;
      }

      if (secondMinMs !== this.lastSecondMinRespMs) {
        this.lastSecondMinRespMs = secondMinMs;
        this.notifiedSecondRespStart = false;
      }

      const nowMs = this.now();

      if (minMs != null && !this.notifiedFirstRespStart && nowMs >= minMs && nowMs < minMs + 1000) {
        this.notifiedFirstRespStart = true;
        this.sendRespStartNotification();
      }

      if (
        secondMinMs != null &&
        !this.notifiedSecondRespStart &&
        nowMs >= secondMinMs &&
        nowMs < secondMinMs + 1000
      ) {
        this.notifiedSecondRespStart = true;
        this.sendRespStartNotification();
      }
    });
  }

  private sendRespStartNotification(): void {
    const rb = this.rb();
    const rbName = String(rb?.displayName ?? rb?.name ?? '').trim() || '???';
    const rbLvl = rb?.lvl;
    const mapUrl = `${SITE_URL}/rb-map-new?focus=${encodeURIComponent(rb?.id ?? '')}`;
    const text =
      `РБ ${rbName}${rbLvl != null ? `[${rbLvl}]` : ''} вошел в респ! Хули сидишь? Пиздуй чекать!!\n\n` +
      `<a href="${mapUrl}">Посмотреть на карте</a>`;
    void this.tgService.sendMessageToTg(text).catch(() => null);
  }

  // ---------- Kill-time editing ----------

  onDeadTimeDraftChange(value: Date | null): void {
    this.deadTime = value;
  }

  hasDeadTimeChanges(): boolean {
    const currentMs = this.deadTime ? this.deadTime.getTime() : null;
    return currentMs !== this.lastCommittedMs;
  }

  commitDeadTime(): void {
    const currentMs = this.deadTime ? this.deadTime.getTime() : null;
    if (currentMs === this.lastCommittedMs) return;
    this.lastCommittedMs = currentMs;
    this.deadTimeChanged.emit({ rb: this.rb(), deadTime: this.deadTime });
  }

  cancelDeadTime(): void {
    const rb = this.rb();
    this.deadTime = rb?.deadTime ?? null;
  }

  clearDeadTime(): void {
    this.deadTime = null;
    this.commitDeadTime();
  }

  setKillTimeNowKyiv(): void {
    this.deadTime = this.nowInKyivAsLocalDate();
    this.commitDeadTime();
  }

  // ---------- Helpers ----------

  private addHours(date: Date | null, hours: any): Date | null {
    if (!date) return null;
    const hoursNumber = Number(hours);
    if (!Number.isFinite(hoursNumber)) return date;
    return new Date(date.getTime() + hoursNumber * 60 * 60 * 1000);
  }

  private durationMsAsLocalTimeDate(durationMs: number): Date {
    const now = new Date();
    const totalSeconds = Math.floor(durationMs / 1000);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, totalSeconds * 1000);
  }

  private formatRuDateTime(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private pluralizeRu(value: number, one: string, few: string, many: string): string {
    const n = Math.abs(Math.trunc(value));
    const lastTwo = n % 100;
    if (lastTwo >= 11 && lastTwo <= 14) return many;
    const last = n % 10;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  private nowInKyivAsLocalDate(): Date {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(new Date());

      const get = (type: string) => parts.find((p) => p.type === type)?.value;
      const year = get('year');
      const month = get('month');
      const day = get('day');
      const hour = get('hour');
      const minute = get('minute');
      const second = get('second');
      if (!year || !month || !day || !hour || !minute || !second) return new Date();
      return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    } catch {
      return new Date();
    }
  }

  toDate(value: any): Date | null {
    if (value == null) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
