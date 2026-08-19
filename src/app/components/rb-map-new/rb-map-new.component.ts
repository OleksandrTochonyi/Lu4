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

import { JsonRb, RbJsonDataService } from '../../services/rb-json-data.service';
import { RbJsonMapService } from '../../services/rb-json-map.service';
import { RbJsonRespService } from '../../services/rb-json-resp.service';
import { GradeBadgeComponent } from '../shared/grade-badge/grade-badge.component';
import { ChanceBadgeComponent } from '../shared/chance-badge/chance-badge.component';
import { BossStatsComponent } from '../shared/boss-stats/boss-stats.component';
import { enrichJsonRb } from '../../utils/rb-json-enrich';
import { RbStatus } from '../../constants/status';

interface MapBoss extends JsonRb {
  mapX: number;
  mapY: number;
  status: RbStatus;
  deadTime: Date | null;
  minResp: Date | null;
  maxResp: Date | null;
  secondMinResp: Date | null;
  secondMaxResp: Date | null;
}

// Map for the db.json raid-boss catalog. Points are placed at the same coordinates as
// the original (Firestore-backed) map — RbJsonDataService matches each db.json monster
// to a positioned Firestore raid-boss doc by name, since map placement lives on the old
// raid-boss docs and isn't duplicated into db.json. Kill time/status come from the
// rb-resp-time collection (this catalog's own store) via the enrichJsonRb adapter, same
// formula as the old map/Home/Bookmarks pages.
@Component({
  selector: 'app-rb-map-new',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    SelectModule,
    TagModule,
    GradeBadgeComponent,
    ChanceBadgeComponent,
    BossStatsComponent,
  ],
  templateUrl: './rb-map-new.component.html',
  styleUrl: './rb-map-new.component.scss',
})
export class RbMapNewComponent {
  private destroyRef = inject(DestroyRef);
  private rbJsonData = inject(RbJsonDataService);
  private jsonMapService = inject(RbJsonMapService);
  private jsonRespService = inject(RbJsonRespService);
  private messageService = inject(MessageService);
  private route = inject(ActivatedRoute);

  readonly mapSrc = 'assets/Interlude-map.jpg';

  private mapImage = viewChild<ElementRef<HTMLImageElement>>('mapImage');
  private pageEl = viewChild<ElementRef<HTMLDivElement>>('pageEl');

  private jsonBosses = signal<any[]>([]);
  readonly loading = signal(true);
  private now = signal(Date.now());

  readonly pageHeight = signal<number | null>(null);

  readonly levelFrom = signal<number | null>(null);
  readonly levelTo = signal<number | null>(null);

  readonly scale = signal(1);
  readonly translateX = signal(0);
  readonly translateY = signal(0);

  readonly selectedBossId = signal<string | null>(null);
  readonly popupPos = signal<{ x: number; y: number } | null>(null);

  readonly addDialogVisible = signal(false);
  readonly placingBossId = signal<string | null>(null);
  readonly pendingBossId = signal<string | null>(null);
  readonly savingPosition = signal(false);

  private pointerMode: 'none' | 'pan' = 'none';
  private moved = false;
  private startClientX = 0;
  private startClientY = 0;
  private startTranslateX = 0;
  private startTranslateY = 0;

  private pendingFocusId: string | null = null;

  constructor() {
    this.pendingFocusId = this.route.snapshot.queryParamMap.get('focus');

    this.rbJsonData
      .getRaidBosses()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((jsonBosses) => {
        this.jsonBosses.set((jsonBosses ?? []).map((b) => enrichJsonRb(b)));
        this.loading.set(false);
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
    const offsetX = (boss.mapX / 100 - 0.5) * w;
    const offsetY = (boss.mapY / 100 - 0.5) * h;

    this.scale.set(zoom);
    this.translateX.set(-zoom * offsetX);
    this.translateY.set(-zoom * offsetY);

    this.selectedBossId.set(boss.id);
    const page = this.pageEl()?.nativeElement.getBoundingClientRect();
    if (page) {
      this.popupPos.set({ x: page.left + page.width / 2, y: page.top + page.height / 2 });
    }
  }

  // ---------- Derived data ----------

  readonly mapBosses = computed<MapBoss[]>(() => {
    const from = this.levelFrom();
    const to = this.levelTo();
    const now = this.now();

    return this.jsonBosses()
      .filter((b): b is MapBoss => b.mapX != null && b.mapY != null)
      .map((b) => ({ ...b, status: this.calculateStatus(b.minResp, b.maxResp, b.secondMinResp, b.secondMaxResp, now) }))
      .filter((b) => {
        if (from != null && b.lvl < from) return false;
        if (to != null && b.lvl > to) return false;
        return true;
      });
  });

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

  pointColor(boss: MapBoss): string {
    switch (boss['status'] as RbStatus) {
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
    const s = boss['status'] as RbStatus;
    return s === RbStatus.InResp || s === RbStatus.SecondResp;
  }

  tagSeverity(boss: MapBoss | null): 'secondary' | 'success' | 'info' | 'warn' | 'danger' | 'contrast' {
    switch (boss?.['status'] as RbStatus) {
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

  async refreshRespSelected(): Promise<void> {
    const boss = this.selectedBoss();
    if (!boss) return;
    try {
      await this.jsonRespService.setKillTime(boss.id, this.nowInKyivAsLocalDate());
      this.messageService.add({ severity: 'success', summary: 'Респ обновлён', detail: boss['displayName'], life: 2500 });
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Не удалось обновить респ', life: 4000 });
    }
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

  readonly selectedBoss = computed<MapBoss | null>(() => {
    const id = this.selectedBossId();
    if (!id) return null;
    return this.mapBosses().find((b) => b.id === id) ?? null;
  });

  /** Bosses that still have no position on the map (for the "add point" dropdown). */
  readonly placeableOptions = computed(() =>
    this.jsonBosses()
      .filter((b) => b.mapX == null || b.mapY == null)
      .slice()
      .sort((a, b) => a.lvl - b.lvl || a.displayName.localeCompare(b.displayName))
      .map((b) => ({ label: `[${b.lvl}] ${b.displayName}`, value: b.id }))
  );

  readonly placingBoss = computed<any | null>(() => {
    const id = this.placingBossId();
    if (!id) return null;
    return this.jsonBosses().find((b) => b.id === id) ?? null;
  });

  readonly mapTransform = computed(
    () => `translate(${this.translateX()}px, ${this.translateY()}px) scale(${this.scale()})`
  );

  private readonly respColorSteps = [4, 5, 6, 7, 8, 9, 10];

  respBadgeClass(respValue: number | null | undefined): string {
    const value = Math.round(Number(respValue));
    return this.respColorSteps.includes(value) ? `resp-${value}` : 'resp-other';
  }

  // ---------- Live resp info for the selected boss's popup ----------

  private isSecondRespWindow = computed(() => {
    const s = this.selectedBoss()?.['status'] as RbStatus | undefined;
    return s === RbStatus.FirstRespPassed || s === RbStatus.SecondResp;
  });

  displayMinResp = computed<Date | null>(() => {
    const boss = this.selectedBoss();
    if (!boss) return null;
    return this.isSecondRespWindow() ? boss['secondMinResp'] ?? null : boss['minResp'] ?? null;
  });

  displayMaxResp = computed<Date | null>(() => {
    const boss = this.selectedBoss();
    if (!boss) return null;
    return this.isSecondRespWindow() ? boss['secondMaxResp'] ?? null : boss['maxResp'] ?? null;
  });

  timeLeftLabel = computed<string>(() => {
    switch (this.selectedBoss()?.['status'] as RbStatus | undefined) {
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
    const boss = this.selectedBoss();
    if (!boss) return null;
    const s = boss['status'] as RbStatus;
    if (s === RbStatus.InResp) return boss['minResp'] ?? null;
    if (s === RbStatus.SecondResp) return boss['secondMinResp'] ?? null;
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
    const boss = this.selectedBoss();
    if (!boss) return null;
    switch (boss['status'] as RbStatus) {
      case RbStatus.Missed:
        return null;
      case RbStatus.InResp:
        return boss['maxResp'] ?? null;
      case RbStatus.FirstRespPassed:
        return boss['secondMinResp'] ?? null;
      case RbStatus.SecondResp:
        return this.addHours(boss['secondMaxResp'] ?? null, boss?.stats?.plusResp);
      case RbStatus.SoonResp:
        return boss['minResp'] ?? null;
      case RbStatus.SoonSecondResp:
        return boss['secondMinResp'] ?? null;
      default:
        return boss['minResp'] ?? null;
    }
  });

  timeLeft = computed<Date | null>(() => {
    const nowMs = this.now();
    const target = this.timeLeftTarget();
    if (!target) return null;
    return this.durationMsAsLocalTimeDate(Math.max(0, target.getTime() - nowMs));
  });

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

  private pluralizeRu(value: number, one: string, few: string, many: string): string {
    const n = Math.abs(Math.trunc(value));
    const lastTwo = n % 100;
    if (lastTwo >= 11 && lastTwo <= 14) return many;
    const last = n % 10;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  // ---------- Filters ----------

  onLevelFromChange(value: number | null): void {
    this.levelFrom.set(value);
  }

  onLevelToChange(value: number | null): void {
    this.levelTo.set(value);
  }

  resetFilters(): void {
    this.levelFrom.set(null);
    this.levelTo.set(null);
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

  @HostListener('window:resize')
  updatePageHeight(): void {
    const el = this.pageEl()?.nativeElement;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    this.pageHeight.set(Math.max(240, window.innerHeight - top));
  }

  // ---------- Pointer interactions ----------

  pointLeft(boss: MapBoss): number {
    return boss.mapX;
  }

  pointTop(boss: MapBoss): number {
    return boss.mapY;
  }

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
      this.savingPosition.set(true);
      try {
        await this.jsonMapService.setPosition(placingId, pos.x, pos.y);
        this.placingBossId.set(null);
        this.messageService.add({ severity: 'success', summary: 'Точка добавлена', life: 2500 });
      } catch {
        this.messageService.add({ severity: 'error', summary: 'Не удалось сохранить точку', life: 4000 });
      } finally {
        this.savingPosition.set(false);
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

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  closePopup(): void {
    this.selectedBossId.set(null);
    this.popupPos.set(null);
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
    if (!boss || boss.mapSource !== 'manual') return;
    try {
      await this.jsonMapService.clearPosition(boss.id);
      this.selectedBossId.set(null);
      this.popupPos.set(null);
      this.messageService.add({ severity: 'success', summary: 'Точка удалена', detail: boss.displayName, life: 2500 });
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Не удалось удалить точку', life: 4000 });
    }
  }

  trackBoss(_index: number, boss: MapBoss): string {
    return boss.id;
  }

  trackIndex(index: number): number {
    return index;
  }
}
