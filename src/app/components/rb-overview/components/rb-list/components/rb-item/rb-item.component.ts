import { Component, DestroyRef, computed, effect, inject, input, OnInit, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { TagModule } from 'primeng/tag';
import { timer } from 'rxjs';

import { RbStatus } from '../../../../../../constants/status';

@Component({
  selector: 'app-rb-item',
  standalone: true,
  imports: [CommonModule, TagModule, DatePickerModule, FormsModule, ButtonModule],
  templateUrl: './rb-item.component.html',
  styleUrl: './rb-item.component.scss',
})
export class RbItemComponent implements OnInit {
  private destroyRef = inject(DestroyRef);

  rb: any = input();
  deadTimeDraftChanged = output<{ rb: any; deadTime: Date | null }>();
  deadTimeChanged = output<{ rb: any; deadTime: Date | null }>();
  deadTime: Date | null = null;

  private lastCommittedMs: number | null = null;

  private lastMinRespMs: number | null = null;
  private lastSecondMinRespMs: number | null = null;
  private playedFirstRespStart = false;
  private playedSecondRespStart = false;

  private now = signal(Date.now());

  status = computed((): string => {
    const rb = this.rb();
    const value = rb?.status;
    return typeof value === 'string' ? value : '';
  });

  tagSeverity = computed<
    'secondary' | 'success' | 'info' | 'warn' | 'danger' | 'contrast'
  >(() => {
    const s = this.status();
    if (s === RbStatus.NotInResp) return 'info';
    if (s === RbStatus.InResp) return 'success';
    if (s === RbStatus.SecondResp) return 'success';
    if (s === RbStatus.FirstRespPassed) return 'danger';
    if (s === RbStatus.Missed) return 'contrast';
    if (s === RbStatus.SoonResp) return 'warn';
    return 'secondary';
  });

  isSecondRespWindow = computed(() => {
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

  timeLeftLabel = computed((): string => {
    const s = this.status();
    if (s === RbStatus.Missed) return 'Ну вот.. все проебали';
    if (s === RbStatus.InResp) return 'До макс. респа';
    if (s === RbStatus.FirstRespPassed) return 'До 2-го мин. респа';
    if (s === RbStatus.SecondResp) return 'До 2-го макс. респа';
    if (s === RbStatus.SoonResp) return 'Скоро респ';
    return 'До мин. респа';
  });

  private timeLeftTarget = computed<Date | null>(() => {
    const rb = this.rb();
    if (!rb) return null;

    const s = this.status();
    if (s === RbStatus.Missed) return null;
    if (s === RbStatus.InResp) return rb.maxResp ?? null;
    if (s === RbStatus.FirstRespPassed) return rb.secondMinResp ?? null;
    if (s === RbStatus.SecondResp) return this.addHours(rb.secondMaxResp ?? null, rb?.meta?.plusMinusRespTime);
    return rb.minResp ?? null;
  });

  timeLeft = computed<Date | null>(() => {
    const nowMs = this.now();
    const target = this.timeLeftTarget();
    if (!target) return null;
    const diffMs = Math.max(0, target.getTime() - nowMs);
    return this.durationMsAsLocalTimeDate(diffMs);
  });

  constructor() {
    effect(() => {
      const rb = this.rb();
      this.deadTime = rb?.deadTime ?? this.toDate(rb?.lastDeadTime);
    });

    effect(() => {
      const rb = this.rb();
      const minResp: Date | null = rb?.minResp ?? null;
      const secondMinResp: Date | null = rb?.secondMinResp ?? null;

      const minMs = minResp instanceof Date ? minResp.getTime() : null;
      const secondMinMs = secondMinResp instanceof Date ? secondMinResp.getTime() : null;

      if (minMs !== this.lastMinRespMs) {
        this.lastMinRespMs = minMs;
        this.playedFirstRespStart = false;
      }

      if (secondMinMs !== this.lastSecondMinRespMs) {
        this.lastSecondMinRespMs = secondMinMs;
        this.playedSecondRespStart = false;
      }

      const nowMs = this.now();

      // "Just started" window: within the first second after the boundary.
      if (
        minMs != null &&
        !this.playedFirstRespStart &&
        nowMs >= minMs &&
        nowMs < minMs + 1000
      ) {
        this.playedFirstRespStart = true;
        this.playRespStartSound();
      }

      if (
        secondMinMs != null &&
        !this.playedSecondRespStart &&
        nowMs >= secondMinMs &&
        nowMs < secondMinMs + 1000
      ) {
        this.playedSecondRespStart = true;
        this.playRespStartSound();
      }
    });
  }

  ngOnInit(): void {
    timer(0, 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.now.set(Date.now());
      });
  }

  toDate(value: any): Date | null {
    if (typeof value.toDate === 'function') return value.toDate();

    if (typeof value.seconds === 'number')
      return new Date(value.seconds * 1000);

    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private durationMsAsLocalTimeDate(durationMs: number): Date {
    // We store a duration inside a Date so it can be formatted as HH:mm.
    // Date formatting uses local timezone, so compensate by shifting with current offset.
    const totalSeconds = Math.floor(durationMs / 1000);
    const flooredMs = totalSeconds * 1000;
    const offsetMs = new Date().getTimezoneOffset() * 60 * 1000;
    return new Date(flooredMs + offsetMs);
  }

  private addHours(date: Date | null, hours: any): Date | null {
    if (!date) return null;
    const hoursNumber = Number(hours);
    if (!Number.isFinite(hoursNumber)) return date;
    return new Date(date.getTime() + hoursNumber * 60 * 60 * 1000);
  }

  onDeadTimeDraftChange(value: Date | null): void {
    this.deadTime = value;
    this.deadTimeDraftChanged.emit({ rb: this.rb(), deadTime: value });
  }

  commitDeadTime(): void {
    const current = this.deadTime;
    const currentMs = current ? current.getTime() : null;
    if (currentMs === this.lastCommittedMs) return;
    this.lastCommittedMs = currentMs;
    this.deadTimeChanged.emit({ rb: this.rb(), deadTime: current });
  }

  setKillTimeNowKyiv(): void {
    const nowKyiv = this.nowInKyivAsLocalDate();
    this.deadTime = nowKyiv;
    this.commitDeadTime();
  }

  private nowInKyivAsLocalDate(): Date {
    // We want the time-of-day to be "Kyiv now" even if the user's local timezone differs.
    // Create a Date using Kyiv-local Y/M/D/H/M/S, interpreted in the user's local timezone.
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

      if (!year || !month || !day || !hour || !minute || !second) {
        return new Date();
      }

      return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    } catch {
      return new Date();
    }
  }

  private playRespStartSound(): void {
    // Best-effort: browsers may block autoplay until user interaction.
    try {
      const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;

      const ctx = new AudioContextCtor();
      const now = ctx.currentTime;

      const beep = (start: number, duration: number, freq: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.15, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + duration);
      };

      beep(now + 0.0, 0.12, 880);
      beep(now + 0.16, 0.12, 880);

      // Close after the sound ends to release resources.
      setTimeout(() => {
        try {
          ctx.close();
        } catch {
          // ignore
        }
      }, 500);
    } catch {
      // ignore
    }
  }
}
