import { Component, OnDestroy, computed, effect, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';

/** one icon-led line in a step's button/feature rundown — `icon` is a PrimeIcons
 *  class suffix (e.g. "pi-trash"), matching the real icon on the real button so the
 *  tour never shows a different symbol than what's actually on screen. `iconBg`/
 *  `iconColor` optionally match a real colored badge (e.g. a status icon that's
 *  green/red/indigo in the actual UI) — left unset, the icon uses the tour's own
 *  neutral blue chip. */
export interface TourBullet {
  icon?: string;
  text: string;
  iconBg?: string;
  iconColor?: string;
}

export interface TourStep {
  title: string;
  /** short paragraphs, rendered as separate <p> elements — never one big wall of text */
  paragraphs: string[];
  /** optional icon-led list (button rundowns etc.), rendered below the paragraphs */
  bullets?: TourBullet[];
  /** CSS selector of the element to spotlight — omitted/not found = a centered card, no cutout */
  target?: string;
  /** preferred side of the callout relative to the target (auto-flips if there's no room) */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** runs right before this step is measured/shown — e.g. switch tabs or expand a
   *  card so the step's `target` actually exists in the DOM by the time it's needed */
  onEnter?: () => void;
}

/**
 * Generic step-by-step "spotlight" tour: dims the page, cuts a hole around the
 * current step's target element (found live via `querySelector`, re-measured
 * on resize/scroll and on a short poll so it tracks layout shifts), and shows
 * a small callout with the step's text plus Назад/Далее/Пропустить controls.
 *
 * Fully content-agnostic — a page wires up its own `TourStep[]` (see
 * BookmarksNewComponent for the first user) and reacts to `(finished)` to
 * persist "done"/"skipped" however it likes.
 */
@Component({
  selector: 'app-guided-tour',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  templateUrl: './guided-tour.component.html',
  styleUrl: './guided-tour.component.scss',
})
export class GuidedTourComponent implements OnDestroy {
  steps = input<TourStep[]>([]);
  active = input(false);
  finished = output<{ skipped: boolean }>();

  readonly stepIndex = signal(0);
  readonly rect = signal<DOMRect | null>(null);
  readonly ready = signal(false);

  readonly total = computed(() => this.steps().length);
  readonly step = computed(() => this.steps()[this.stepIndex()] ?? null);
  readonly isLast = computed(() => this.stepIndex() >= this.total() - 1);
  readonly isFirst = computed(() => this.stepIndex() === 0);

  readonly calloutStyle = computed<Record<string, string>>(() => {
    const r = this.rect();
    if (!r) {
      // no target (or not found yet) — centered card
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }
    const margin = 16;
    const calloutWidth = 340;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const spaceBelow = viewportH - r.bottom;
    const placeBelow = spaceBelow > 180 || r.top < 180;

    let left = r.left + r.width / 2 - calloutWidth / 2;
    left = Math.max(margin, Math.min(left, viewportW - calloutWidth - margin));

    if (placeBelow) {
      return { top: `${r.bottom + margin}px`, left: `${left}px`, transform: 'none' };
    }
    return { top: `${r.top - margin}px`, left: `${left}px`, transform: 'translateY(-100%)' };
  });

  readonly spotlightStyle = computed<Record<string, string>>(() => {
    const r = this.rect();
    if (!r) return {} as Record<string, string>;
    const pad = 6;
    return {
      top: `${r.top - pad}px`,
      left: `${r.left - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    };
  });

  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private wasActive = false;
  private readonly onWindowChange = () => this.measure();

  constructor() {
    effect(() => {
      const isActive = this.active();
      // touch stepIndex so this effect re-runs (and re-measures) on step change
      this.stepIndex();
      if (isActive) {
        if (!this.wasActive) this.stepIndex.set(0);
        this.step()?.onEnter?.();
        this.ready.set(false);
        this.measure();
        this.startPolling();
      } else {
        this.stopPolling();
      }
      this.wasActive = isActive;
    });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  private startPolling(): void {
    this.stopPolling();
    window.addEventListener('resize', this.onWindowChange);
    window.addEventListener('scroll', this.onWindowChange, true);
    this.pollHandle = setInterval(() => this.measure(), 400);
  }

  private stopPolling(): void {
    window.removeEventListener('resize', this.onWindowChange);
    window.removeEventListener('scroll', this.onWindowChange, true);
    if (this.pollHandle != null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private measure(): void {
    const step = this.step();
    if (!step?.target) {
      this.rect.set(null);
      this.ready.set(true);
      return;
    }
    const el = document.querySelector(step.target);
    if (!el) {
      this.rect.set(null);
      this.ready.set(true);
      return;
    }
    el.scrollIntoView({ block: 'center', behavior: 'auto' });
    this.rect.set(el.getBoundingClientRect());
    this.ready.set(true);
  }

  next(): void {
    if (this.isLast()) {
      this.finished.emit({ skipped: false });
      return;
    }
    this.stepIndex.update((i) => i + 1);
  }

  back(): void {
    if (this.isFirst()) return;
    this.stepIndex.update((i) => i - 1);
  }

  skip(): void {
    this.finished.emit({ skipped: true });
  }
}
