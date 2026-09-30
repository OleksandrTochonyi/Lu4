import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { GradeBadgeComponent } from '../grade-badge/grade-badge.component';
import { CostNode } from '../../../utils/craft-cost';
import { CraftPriceService, formatAdena, parseAdena, shortAdena } from '../../../services/craft-price.service';

interface AdenRow {
  n: CostNode;
  price: number;
  /** adena for what's still missing */
  buy: number;
}

/**
 * Craft plan priced in adena: per-resource price (remembered in this browser),
 * what the stock already covers, and how much adena buying the shortfall costs.
 * Fed the plan `rollup` (leaf resources, one row each — no double counting).
 */
@Component({
  selector: 'app-cost-aden',
  standalone: true,
  imports: [CommonModule, TooltipModule, GradeBadgeComponent],
  templateUrl: './cost-aden.component.html',
  styleUrl: './cost-aden.component.scss',
})
export class CostAdenComponent {
  private readonly priceSvc = inject(CraftPriceService);

  readonly rows = input.required<CostNode[]>();
  /** hide rows the stock fully covers */
  readonly onlyMissing = signal(false);

  readonly priced = computed<AdenRow[]>(() => {
    const prices = this.priceSvc.prices();
    return this.rows().map((n) => {
      const price = prices[n.resKey] ?? 0;
      return { n, price, buy: n.effShort * price };
    });
  });

  readonly visible = computed(() =>
    this.onlyMissing() ? this.priced().filter((r) => r.n.effShort > 0) : this.priced(),
  );

  readonly totals = computed(() => {
    let buy = 0;
    let covered = 0;
    let unpriced = 0;
    let missingKinds = 0;
    for (const r of this.priced()) {
      if (r.n.effShort > 0) {
        missingKinds++;
        if (!r.price) unpriced++;
      }
      buy += r.buy;
      covered += r.n.have * r.price;
    }
    return { buy, covered, all: buy + covered, unpriced, missingKinds };
  });

  /** how many rows of this plan have a price — the «Очистить цены» button needs some */
  readonly pricedCount = computed(() => this.priced().filter((r) => r.price > 0).length);
  /** inline "точно?" step before clearing */
  readonly confirmClear = signal(false);

  clearPrices(): void {
    this.priceSvc.clear(this.rows().map((n) => n.resKey));
    this.confirmClear.set(false);
  }

  readonly fmt = formatAdena;
  readonly short = shortAdena;

  priceText(price: number): string {
    return price ? formatAdena(price) : '';
  }

  /** (change) = blur / Enter — parse "150к", "1.5кк", "1 500 000" */
  onPrice(resKey: string, e: Event): void {
    const el = e.target as HTMLInputElement;
    const v = parseAdena(el.value);
    if (v == null) {
      el.classList.add('is-bad');
      return;
    }
    el.classList.remove('is-bad');
    this.priceSvc.setPrice(resKey, v);
    el.value = this.priceText(this.priceSvc.price(resKey));
  }

  blurOnEnter(e: Event): void {
    (e.target as HTMLInputElement).blur();
  }

  showGrade(category: string | null | undefined): boolean {
    return category === 'weapon' || category === 'armor' || category === 'jewelry';
  }

  imgError(e: Event): void {
    const el = e.target as HTMLImageElement | null;
    if (el) el.style.visibility = 'hidden';
  }

  trackRow = (_: number, r: AdenRow) => r.n.key;
}
