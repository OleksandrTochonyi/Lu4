import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { timer } from 'rxjs';

import { RbStatus } from '../../../../constants/status';

@Component({
  selector: 'app-rb-grid',
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    TagModule,
    DatePickerModule,
    ButtonModule,
  ],
  templateUrl: './rb-grid.component.html',
  styleUrl: './rb-grid.component.scss'
})
export class RbGridComponent implements OnInit {
  private destroyRef = inject(DestroyRef);

  items = input<any[]>([]);
  deadTimeDraftChanged = output<{ rb: any; deadTime: Date | null }>();
  deadTimeChanged = output<{ rb: any; deadTime: Date | null }>();

  now = signal(Date.now());

  // While user edits the DatePicker input, frequent re-renders can cause UI to feel frozen.
  // We pause the 1s ticker during active editing.
  private editingKey = signal<string | null>(null);

  private draftDeadTimeByKey = new Map<string, Date | null>();

  ngOnInit(): void {
    timer(0, 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.editingKey() != null) return;
        this.now.set(Date.now());
      });
  }

  beginEdit(rb: any): void {
    this.editingKey.set(this.getKey(rb));
  }

  endEdit(event: FocusEvent): void {
    const current = event.currentTarget as HTMLElement | null;
    const next = event.relatedTarget as Node | null;
    if (current && next && current.contains(next)) return;
    this.editingKey.set(null);
  }

  getKey(rb: any): string {
    const id = rb?.id;
    if (id != null) return String(id);
    const name = rb?.name ?? rb?.displayName;
    return String(name ?? '');
  }

  getDraftDeadTime(rb: any): Date | null {
    const key = this.getKey(rb);
    if (this.draftDeadTimeByKey.has(key)) return this.draftDeadTimeByKey.get(key) ?? null;
    const committed = rb?.deadTime ?? this.toDate(rb?.lastDeadTime);
    return committed ?? null;
  }

  onDeadTimeDraftChange(rb: any, value: Date | null): void {
    const key = this.getKey(rb);
    const coerced = this.coerceDate(value);
    // While user is typing in the input, PrimeNG can surface intermediate values.
    // Ignore invalid intermediate values to avoid thrashing the table rendering.
    if (coerced === undefined) return;

    this.draftDeadTimeByKey.set(key, coerced);
    // Intentionally do NOT emit deadTimeDraftChanged on every change:
    // parent updates would recreate table rows/inputs and can feel like a freeze.
  }

  hasDeadTimeChanges(rb: any): boolean {
    const committed = rb?.deadTime ?? this.toDate(rb?.lastDeadTime);
    const committedMs = committed instanceof Date ? committed.getTime() : null;
    const draft = this.getDraftDeadTime(rb);
    const draftMs = draft instanceof Date ? draft.getTime() : null;
    return committedMs !== draftMs;
  }

  commitDeadTime(rb: any): void {
    const draft = this.getDraftDeadTime(rb);
    if (!this.hasDeadTimeChanges(rb)) return;
    this.editingKey.set(null);
    this.draftDeadTimeByKey.delete(this.getKey(rb));
    this.deadTimeChanged.emit({ rb, deadTime: draft });
  }

  cancelDeadTime(rb: any): void {
    this.editingKey.set(null);
    this.draftDeadTimeByKey.delete(this.getKey(rb));
  }

  setKillTimeNowKyiv(rb: any): void {
    const nowKyiv = this.nowInKyivAsLocalDate();
    this.onDeadTimeDraftChange(rb, nowKyiv);
    this.commitDeadTime(rb);
  }

  openInfoLink(rb: any): void {
    const url: string | undefined = rb?.meta?.infoLink;
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }

  status = computed(() => {
    // Touch now() so computed invalidates each second for the template.
    this.now();
    return true;
  });

  getRowStatus(rb: any): RbStatus {
    const minResp: Date | null = rb?.minResp ?? null;
    const maxResp: Date | null = rb?.maxResp ?? null;
    const secondMinResp: Date | null = rb?.secondMinResp ?? null;
    const secondMaxResp: Date | null = rb?.secondMaxResp ?? null;
    return this.calculateStatus(minResp, maxResp, secondMinResp, secondMaxResp);
  }

  getTagSeverity(rb: any): 'secondary' | 'success' | 'info' | 'warn' | 'danger' | 'contrast' {
    const s = this.getRowStatus(rb);
    if (s === RbStatus.NotInResp) return 'info';
    if (s === RbStatus.InResp) return 'success';
    if (s === RbStatus.SecondResp) return 'success';
    if (s === RbStatus.FirstRespPassed) return 'danger';
    if (s === RbStatus.Missed) return 'contrast';
    if (s === RbStatus.SoonResp) return 'warn';
    if (s === RbStatus.SoonSecondResp) return 'warn';
    return 'secondary';
  }

  getRowBgClass(rb: any): string {
    const s = this.getRowStatus(rb);
    if (s === RbStatus.NotInResp) return 'rb-bg-default';
    if (s === RbStatus.Missed) return 'rb-bg-missed';
    if (s === RbStatus.InResp || s === RbStatus.SecondResp) return 'rb-bg-success';
    if (s === RbStatus.FirstRespPassed) return 'rb-bg-danger';
    if (s === RbStatus.SoonResp || s === RbStatus.SoonSecondResp) return 'rb-bg-warn';
    return 'rb-bg-secondary';
  }

  isSecondRespWindow(status: RbStatus): boolean {
    return status === RbStatus.FirstRespPassed || status === RbStatus.SecondResp;
  }

  displayMinResp(rb: any): Date | null {
    const s = this.getRowStatus(rb);
    return this.isSecondRespWindow(s) ? rb?.secondMinResp ?? null : rb?.minResp ?? null;
  }

  displayMaxResp(rb: any): Date | null {
    const s = this.getRowStatus(rb);
    return this.isSecondRespWindow(s) ? rb?.secondMaxResp ?? null : rb?.maxResp ?? null;
  }

  timeLeftLabel(rb: any): string {
    const s = this.getRowStatus(rb);
    if (s === RbStatus.Missed) return 'Ну вот.. все проебали';
    if (s === RbStatus.InResp) return 'В респе уже';
    if (s === RbStatus.FirstRespPassed) return 'До 2-го мин. респа';
    if (s === RbStatus.SecondResp) return 'Во 2м респе уже';
    if (s === RbStatus.SoonResp) return 'Первый респ через';
    if (s === RbStatus.SoonSecondResp) return 'Второй респ через';
    return 'До мин. респа';
  }

  respElapsedLabel(rb: any): string | null {
    const s = this.getRowStatus(rb);
    const start: Date | null = s === RbStatus.InResp ? rb?.minResp ?? null : s === RbStatus.SecondResp ? rb?.secondMinResp ?? null : null;
    if (!start) return null;

    const diffMs = Math.max(0, this.now() - start.getTime());
    const totalMinutes = Math.floor(diffMs / (60 * 1000));
    if (totalMinutes < 60) return `${totalMinutes} ${this.pluralizeRu(totalMinutes, 'минута', 'минуты', 'минут')}`;

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const hoursLabel = `${hours} ${this.pluralizeRu(hours, 'час', 'часа', 'часов')}`;
    if (minutes === 0) return hoursLabel;
    const minutesLabel = `${minutes} ${this.pluralizeRu(minutes, 'минута', 'минуты', 'минут')}`;
    return `${hoursLabel} ${minutesLabel}`;
  }

  timeLeft(rb: any): Date | null {
    const status = this.getRowStatus(rb);
    const target = this.timeLeftTarget(rb, status);
    if (!target) return null;
    const diffMs = Math.max(0, target.getTime() - this.now());
    return this.durationMsAsLocalTimeDate(diffMs);
  }

  private timeLeftTarget(rb: any, status: RbStatus): Date | null {
    if (!rb) return null;
    if (status === RbStatus.Missed) return null;
    if (status === RbStatus.InResp) return rb?.maxResp ?? null;
    if (status === RbStatus.FirstRespPassed) return rb?.secondMinResp ?? null;
    if (status === RbStatus.SecondResp)
      return this.addHours(rb?.secondMaxResp ?? null, rb?.meta?.plusMinusRespTime);
    if (status === RbStatus.SoonResp) return rb?.minResp ?? null;
    if (status === RbStatus.SoonSecondResp) return rb?.secondMinResp ?? null;
    return rb?.minResp ?? null;
  }

  private calculateStatus(
    minResp: Date | null,
    maxResp: Date | null,
    secondMinResp: Date | null,
    secondMaxResp: Date | null
  ): RbStatus {
    if (!minResp || !maxResp || !secondMinResp || !secondMaxResp) return RbStatus.Unknown;

    const now = this.now();
    const hourMs = 60 * 60 * 1000;
    const min = minResp.getTime();
    const max = maxResp.getTime();
    const secondMin = secondMinResp.getTime();
    const secondMax = secondMaxResp.getTime();

    if (now < min) {
      if (min - now <= hourMs) return RbStatus.SoonResp;
      return RbStatus.NotInResp;
    }
    if (now >= min && now <= max) return RbStatus.InResp;
    if (now > max && now < secondMin) {
      if (secondMin - now <= hourMs) return RbStatus.SoonSecondResp;
      return RbStatus.FirstRespPassed;
    }
    if (now >= secondMin && now <= secondMax) return RbStatus.SecondResp;
    return RbStatus.Missed;
  }

  private durationMsAsLocalTimeDate(durationMs: number): Date {
    const totalSeconds = Math.floor(durationMs / 1000);
    const flooredMs = totalSeconds * 1000;
    const offsetMs = new Date().getTimezoneOffset() * 60 * 1000;
    return new Date(flooredMs + offsetMs);
  }

  private toDate(value: any): Date | null {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private addHours(date: Date | null, hours: any): Date | null {
    if (!date) return null;
    const hoursNumber = Number(hours);
    if (!Number.isFinite(hoursNumber)) return date;
    return new Date(date.getTime() + hoursNumber * 60 * 60 * 1000);
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

      if (!year || !month || !day || !hour || !minute || !second) {
        return new Date();
      }

      return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    } catch {
      return new Date();
    }
  }

  // Returns:
  // - Date: valid
  // - null: explicit empty
  // - undefined: invalid/intermediate input (ignore)
  private coerceDate(value: any): Date | null | undefined {
    if (value == null || value === '') return null;
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value : undefined;
    }
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : undefined;
  }
}
