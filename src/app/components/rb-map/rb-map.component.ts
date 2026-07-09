import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { MessageService } from 'primeng/api';

import { RbData } from '../../services/rb-data';
import { RaidBossService } from '../../services/raid-boss.service';
import { RbStatus } from '../../constants/status';

interface MapBoss {
  id: string;
  displayName: string;
  lvl: number;
  mapX: number | null;
  mapY: number | null;
  deadTime: Date | null;
  minResp: Date | null;
  maxResp: Date | null;
  secondMinResp: Date | null;
  secondMaxResp: Date | null;
  status: RbStatus;
  raw: any;
}

@Component({
  selector: 'app-rb-map',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    SelectModule,
    TagModule,
  ],
  templateUrl: './rb-map.component.html',
  styleUrl: './rb-map.component.scss',
})
export class RbMapComponent {
  private destroyRef = inject(DestroyRef);
  private rbDataService = inject(RbData);
  private raidBossService = inject(RaidBossService);
  private messageService = inject(MessageService);
  private route = inject(ActivatedRoute);

  readonly mapSrc = 'assets/Interlude-map.jpg';

  private readonly LS_LEVEL_FROM = 'rb-map-level-from';
  private readonly LS_LEVEL_TO = 'rb-map-level-to';

  private mapImage = viewChild<ElementRef<HTMLImageElement>>('mapImage');
  private pageEl = viewChild<ElementRef<HTMLDivElement>>('pageEl');

  private now = signal(Date.now());
  private rawBosses = signal<any[]>([]);

  readonly pageHeight = signal<number | null>(null);

  readonly levelFrom = signal<number | null>(this.readStoredLevel(this.LS_LEVEL_FROM));
  readonly levelTo = signal<number | null>(this.readStoredLevel(this.LS_LEVEL_TO));

  // View transform (zoom + pan)
  readonly scale = signal(1);
  readonly translateX = signal(0);
  readonly translateY = signal(0);

  // Interaction state
  readonly selectedBossId = signal<string | null>(null);
  readonly popupPos = signal<{ x: number; y: number } | null>(null);

  readonly addDialogVisible = signal(false);
  readonly placingBossId = signal<string | null>(null);
  readonly pendingBossId = signal<string | null>(null);

  private pointerMode: 'none' | 'pan' = 'none';
  private moved = false;
  private startClientX = 0;
  private startClientY = 0;
  private startTranslateX = 0;
  private startTranslateY = 0;

  private pendingFocusId: string | null = null;

  constructor() {
    this.pendingFocusId = this.route.snapshot.queryParamMap.get('focus');

    this.rbDataService
      .getItems()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => {
        this.rawBosses.set(items ?? []);
        this.tryFocus();
      });

    timer(0, 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));

    afterNextRender(() => {
      this.updatePageHeight();
      this.tryFocus();
    });
  }

  onMapImageLoad(): void {
    this.tryFocus();
  }

  private tryFocus(): void {
    const id = this.pendingFocusId;
    if (!id) return;
    const boss = this.mapBosses().find((b) => b.id === id);
    const img = this.mapImage()?.nativeElement;
    if (!boss || !img || !img.clientWidth || !img.clientHeight) return;
    this.pendingFocusId = null;
    this.focusOnBoss(boss);
  }

  private focusOnBoss(boss: MapBoss): void {
    const img = this.mapImage()?.nativeElement;
    if (!img) return;
    const w = img.clientWidth;
    const h = img.clientHeight;
    if (!w || !h) return;

    const zoom = 1.5;
    const offsetX = ((boss.mapX ?? 50) / 100 - 0.5) * w;
    const offsetY = ((boss.mapY ?? 50) / 100 - 0.5) * h;

    this.scale.set(zoom);
    this.translateX.set(-zoom * offsetX);
    this.translateY.set(-zoom * offsetY);

    this.selectedBossId.set(boss.id);
    const page = this.pageEl()?.nativeElement.getBoundingClientRect();
    if (page) {
      this.popupPos.set({ x: page.left + page.width / 2, y: page.top + page.height / 2 });
    }
  }

  @HostListener('window:resize')
  updatePageHeight(): void {
    const el = this.pageEl()?.nativeElement;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    this.pageHeight.set(Math.max(240, window.innerHeight - top));
  }

  // ---------- Derived data ----------

  private enrichedBosses = computed<MapBoss[]>(() => {
    const now = this.now();
    return (this.rawBosses() ?? []).map((item) => this.enrich(item, now));
  });

  readonly mapBosses = computed<MapBoss[]>(() => {
    const from = this.levelFrom();
    const to = this.levelTo();
    return this.enrichedBosses().filter((b) => {
      if (b.mapX == null || b.mapY == null) return false;
      if (from != null && b.lvl < from) return false;
      if (to != null && b.lvl > to) return false;
      return true;
    });
  });

  /** Bosses that still have no position on the map (for the "add" dropdown). */
  readonly placeableOptions = computed(() =>
    this.enrichedBosses()
      .filter((b) => b.mapX == null || b.mapY == null)
      .slice()
      .sort((a, b) => a.lvl - b.lvl || a.displayName.localeCompare(b.displayName))
      .map((b) => ({ label: `[${b.lvl}] ${b.displayName}`, value: b.id }))
  );

  readonly selectedBoss = computed<MapBoss | null>(() => {
    const id = this.selectedBossId();
    if (!id) return null;
    return this.enrichedBosses().find((b) => b.id === id) ?? null;
  });

  readonly placingBoss = computed<MapBoss | null>(() => {
    const id = this.placingBossId();
    if (!id) return null;
    return this.enrichedBosses().find((b) => b.id === id) ?? null;
  });

  readonly mapTransform = computed(
    () => `translate(${this.translateX()}px, ${this.translateY()}px) scale(${this.scale()})`
  );

  pointLeft(boss: MapBoss): number {
    return boss.mapX ?? 0;
  }

  pointTop(boss: MapBoss): number {
    return boss.mapY ?? 0;
  }

  pointColor(boss: MapBoss): string {
    switch (boss.status) {
      case RbStatus.InResp:
      case RbStatus.SecondResp:
        return '#22c55e';
      case RbStatus.FirstRespPassed:
        return '#ef4444';
      case RbStatus.Missed:
        return '#64748b';
      case RbStatus.SoonResp:
      case RbStatus.SoonSecondResp:
        return '#f59e0b';
      case RbStatus.NotInResp:
        return '#3b82f6';
      default:
        return '#94a3b8';
    }
  }

  isPulsing(boss: MapBoss): boolean {
    return boss.status === RbStatus.InResp || boss.status === RbStatus.SecondResp;
  }

  tagSeverity(
    boss: MapBoss | null
  ): 'secondary' | 'success' | 'info' | 'warn' | 'danger' | 'contrast' {
    if (!boss) return 'secondary';
    switch (boss.status) {
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
  }

  // ---------- Resp info (mirrors the main page) ----------

  private isSecondRespWindow(boss: MapBoss): boolean {
    return boss.status === RbStatus.FirstRespPassed || boss.status === RbStatus.SecondResp;
  }

  displayMinResp(boss: MapBoss | null): Date | null {
    if (!boss) return null;
    return this.isSecondRespWindow(boss) ? boss.secondMinResp : boss.minResp;
  }

  displayMaxResp(boss: MapBoss | null): Date | null {
    if (!boss) return null;
    return this.isSecondRespWindow(boss) ? boss.secondMaxResp : boss.maxResp;
  }

  timeLeftLabel(boss: MapBoss | null): string {
    if (!boss) return '';
    switch (boss.status) {
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
  }

  private respStart(boss: MapBoss): Date | null {
    if (boss.status === RbStatus.InResp) return boss.minResp;
    if (boss.status === RbStatus.SecondResp) return boss.secondMinResp;
    return null;
  }

  respElapsedLabel(boss: MapBoss | null): string | null {
    if (!boss) return null;
    const start = this.respStart(boss);
    if (!start) return null;
    const diffMs = Math.max(0, this.now() - start.getTime());
    const totalMinutes = Math.floor(diffMs / (60 * 1000));
    if (totalMinutes < 60)
      return `${totalMinutes} ${this.pluralizeRu(totalMinutes, 'минута', 'минуты', 'минут')}`;

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const hoursLabel = `${hours} ${this.pluralizeRu(hours, 'час', 'часа', 'часов')}`;
    if (minutes === 0) return hoursLabel;
    const minutesLabel = `${minutes} ${this.pluralizeRu(minutes, 'минута', 'минуты', 'минут')}`;
    return `${hoursLabel} ${minutesLabel}`;
  }

  private timeLeftTarget(boss: MapBoss): Date | null {
    switch (boss.status) {
      case RbStatus.Missed:
        return null;
      case RbStatus.InResp:
        return boss.maxResp;
      case RbStatus.FirstRespPassed:
        return boss.secondMinResp;
      case RbStatus.SecondResp:
        return this.addHours(boss.secondMaxResp, boss.raw?.meta?.plusMinusRespTime);
      case RbStatus.SoonResp:
        return boss.minResp;
      case RbStatus.SoonSecondResp:
        return boss.secondMinResp;
      default:
        return boss.minResp;
    }
  }

  timeLeftLabelValue(boss: MapBoss | null): string {
    if (!boss) return '—';
    const elapsed = this.respElapsedLabel(boss);
    if (elapsed != null) return elapsed;
    const target = this.timeLeftTarget(boss);
    if (!target) return '—';
    const diffMs = Math.max(0, target.getTime() - this.now());
    return this.formatDuration(diffMs);
  }

  private formatDuration(durationMs: number): string {
    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  // ---------- Filters ----------

  onLevelFromChange(value: number | null): void {
    this.levelFrom.set(value);
    this.writeStoredLevel(this.LS_LEVEL_FROM, value);
  }

  onLevelToChange(value: number | null): void {
    this.levelTo.set(value);
    this.writeStoredLevel(this.LS_LEVEL_TO, value);
  }

  resetFilters(): void {
    this.levelFrom.set(null);
    this.levelTo.set(null);
    this.writeStoredLevel(this.LS_LEVEL_FROM, null);
    this.writeStoredLevel(this.LS_LEVEL_TO, null);
  }

  // ---------- Zoom controls ----------

  zoomIn(): void {
    this.scale.update((s) => Math.min(5, +(s + 0.25).toFixed(2)));
  }

  zoomOut(): void {
    this.scale.update((s) => Math.max(0.5, +(s - 0.25).toFixed(2)));
  }

  resetView(): void {
    this.scale.set(1);
    this.translateX.set(0);
    this.translateY.set(0);
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.15 : -0.15;
    this.scale.update((s) => Math.min(5, Math.max(0.5, +(s + delta).toFixed(2))));
  }

  // ---------- Add / place flow ----------

  openAddDialog(): void {
    this.pendingBossId.set(null);
    this.addDialogVisible.set(true);
  }

  confirmAdd(): void {
    const id = this.pendingBossId();
    if (!id) return;
    this.placingBossId.set(id);
    this.addDialogVisible.set(false);
    this.selectedBossId.set(null);
    this.popupPos.set(null);
  }

  cancelPlacing(): void {
    this.placingBossId.set(null);
  }

  startMoveSelected(): void {
    const boss = this.selectedBoss();
    if (!boss) return;
    this.placingBossId.set(boss.id);
    this.selectedBossId.set(null);
    this.popupPos.set(null);
  }

  async removeSelectedPoint(): Promise<void> {
    const boss = this.selectedBoss();
    if (!boss) return;
    try {
      await this.raidBossService.clearMapPosition(boss.id);
      this.selectedBossId.set(null);
      this.popupPos.set(null);
      this.messageService.add({
        severity: 'success',
        summary: 'Точка удалена',
        detail: boss.displayName,
        life: 2500,
      });
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Не удалось удалить точку', life: 4000 });
    }
  }

  async refreshRespSelected(): Promise<void> {
    const boss = this.selectedBoss();
    if (!boss) return;
    const nowKyiv = this.nowInKyivAsLocalDate();
    try {
      await this.rbDataService.setKillTime(boss.id, nowKyiv);
      this.messageService.add({
        severity: 'success',
        summary: 'Респ обновлён',
        detail: boss.displayName,
        life: 2500,
      });
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Не удалось обновить респ', life: 4000 });
    }
  }

  closePopup(): void {
    this.selectedBossId.set(null);
    this.popupPos.set(null);
  }

  // ---------- Pointer interactions ----------

  onPointPointerDown(event: PointerEvent, boss: MapBoss): void {
    if (this.placingBossId()) return;
    // Points are not draggable: a click just opens the info popup.
    event.stopPropagation();
    this.selectedBossId.set(boss.id);
    this.popupPos.set({ x: event.clientX, y: event.clientY });
  }

  onViewportPointerDown(event: PointerEvent): void {
    if (this.placingBossId()) return;
    this.pointerMode = 'pan';
    this.moved = false;
    this.startClientX = event.clientX;
    this.startClientY = event.clientY;
    this.startTranslateX = this.translateX();
    this.startTranslateY = this.translateY();
  }

  @HostListener('window:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (this.pointerMode !== 'pan') return;

    // Only pan while a button is actually held down; if it was released
    // (e.g. outside the window and the pointerup was missed), stop panning.
    if (event.buttons === 0) {
      this.pointerMode = 'none';
      return;
    }

    const dx = event.clientX - this.startClientX;
    const dy = event.clientY - this.startClientY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) this.moved = true;

    this.translateX.set(this.startTranslateX + dx);
    this.translateY.set(this.startTranslateY + dy);
  }

  @HostListener('window:pointerup')
  @HostListener('window:pointercancel')
  onPointerUp(): void {
    this.pointerMode = 'none';
  }

  async onMapClick(event: MouseEvent): Promise<void> {
    // Ignore clicks that were the tail-end of a pan drag.
    if (this.moved) {
      this.moved = false;
      return;
    }

    const placingId = this.placingBossId();
    if (placingId) {
      const pos = this.toPercent(event.clientX, event.clientY);
      if (!pos) return;
      try {
        await this.raidBossService.setMapPosition(placingId, pos.x, pos.y);
        this.placingBossId.set(null);
        this.messageService.add({
          severity: 'success',
          summary: 'Точка добавлена',
          life: 2500,
        });
      } catch {
        this.messageService.add({ severity: 'error', summary: 'Не удалось сохранить точку', life: 4000 });
      }
      return;
    }

    // Click on empty map area closes an open popup.
    this.closePopup();
  }

  private toPercent(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.mapImage()?.nativeElement.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: this.clamp(((clientX - rect.left) / rect.width) * 100, 0, 100),
      y: this.clamp(((clientY - rect.top) / rect.height) * 100, 0, 100),
    };
  }

  // ---------- Helpers ----------

  private enrich(item: any, now: number): MapBoss {
    const deadTime = this.toDate(item?.lastDeadTime);
    const respTimeHours = item?.meta?.respTime;
    const plusMinusHours = item?.meta?.plusMinusRespTime;

    const minResp = this.addHours(deadTime, respTimeHours);
    const maxResp = this.addHours(minResp, plusMinusHours);
    const secondMinResp = this.addHours(minResp, respTimeHours);
    const secondMaxResp = this.addHours(
      maxResp,
      (Number(respTimeHours) || 0) + (Number(plusMinusHours) || 0)
    );

    const status = this.calculateStatus(minResp, maxResp, secondMinResp, secondMaxResp, now);

    return {
      id: item?.id,
      displayName: item?.displayName ?? item?.name ?? '',
      lvl: Number(item?.lvl ?? item?.level ?? 0),
      mapX: typeof item?.mapX === 'number' ? item.mapX : null,
      mapY: typeof item?.mapY === 'number' ? item.mapY : null,
      deadTime,
      minResp,
      maxResp,
      secondMinResp,
      secondMaxResp,
      status,
      raw: item,
    };
  }

  private calculateStatus(
    minResp: Date | null,
    maxResp: Date | null,
    secondMinResp: Date | null,
    secondMaxResp: Date | null,
    now: number
  ): RbStatus {
    if (!minResp || !maxResp || !secondMinResp || !secondMaxResp) return RbStatus.Unknown;

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

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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

  private readStoredLevel(key: string): number | null {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null || raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  private writeStoredLevel(key: string, value: number | null): void {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch {
      // ignore
    }
  }

  trackBoss(_index: number, boss: MapBoss): string {
    return boss.id;
  }
}
