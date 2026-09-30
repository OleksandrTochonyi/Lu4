import { Injectable, signal } from '@angular/core';

const LS_PRICES = 'craft-aden-prices';

function readPrices(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PRICES) ?? '{}');
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw ?? {})) {
      const n = Number(v);
      if (k && Number.isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Per-browser price list for craft resources (adena per 1 unit), keyed by the
 * resource identity the cost calculator uses (`CostNode.resKey`: catalogId or
 * normalized name). Feeds the "в адене" view of the craft plan.
 */
@Injectable({ providedIn: 'root' })
export class CraftPriceService {
  readonly prices = signal<Record<string, number>>(readPrices());

  price(resKey: string): number {
    return this.prices()[resKey] ?? 0;
  }

  /** drop the prices of these resources */
  clear(resKeys: string[]): void {
    this.prices.update((all) => {
      const next = { ...all };
      for (const k of resKeys) delete next[k];
      return next;
    });
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(LS_PRICES, JSON.stringify(this.prices()));
    } catch {
      /* ignore */
    }
  }

  /** 0 / empty clears the price */
  setPrice(resKey: string, value: number | null): void {
    const n = Math.max(0, Math.round(Number(value) || 0));
    this.prices.update((all) => {
      const next = { ...all };
      if (n > 0) next[resKey] = n;
      else delete next[resKey];
      return next;
    });
    this.save();
  }
}

/**
 * "1500000", "1 500 000", "1.5кк", "150к", "2kk", "1,2ккк" → adena.
 * к / k = ×1 000 (each extra letter ×1 000 more). Returns null for junk.
 */
export function parseAdena(input: string | null | undefined): number | null {
  const s = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(',', '.');
  if (!s) return 0;
  const m = /^(\d+(?:\.\d+)?)([кk]*)$/.exec(s);
  if (!m) return null;
  const mult = Math.pow(1000, m[2].length);
  return Math.round(parseFloat(m[1]) * mult);
}

/** 1234567 → "1 234 567" */
export function formatAdena(n: number): string {
  return Math.round(n || 0).toLocaleString('ru-RU');
}

/** 1234567 → "1.23кк" — the short L2 notation */
export function shortAdena(n: number): string {
  const v = Math.round(n || 0);
  const trim = (x: number) => (Math.round(x * 100) / 100).toString();
  if (v >= 1e9) return trim(v / 1e9) + 'ккк';
  if (v >= 1e6) return trim(v / 1e6) + 'кк';
  if (v >= 1e3) return trim(v / 1e3) + 'к';
  return String(v);
}
