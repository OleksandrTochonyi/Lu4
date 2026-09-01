import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

/**
 * Everything craftable / stockable from `assets/data/data.json` — finished
 * items, parts, resources, recipes — flattened into one list the Warehouse
 * page can filter, sort and cross-reference against the clan stock.
 */

const LOCAL_ICON_DIR = 'assets/item-icons/';

export type CraftGrade = 'NG' | 'D' | 'C' | 'B' | 'A' | 'S';
export type CraftCategory =
  | 'weapon'
  | 'armor'
  | 'jewelry'
  | 'resource'
  | 'part'
  | 'recipe'
  | 'other';

export const CRAFT_CATEGORY_LABEL: Record<CraftCategory, string> = {
  weapon: 'Оружие',
  armor: 'Броня',
  jewelry: 'Бижутерия',
  resource: 'Ресурсы',
  part: 'Части',
  recipe: 'Рецепты',
  other: 'Прочее',
};

export const CRAFT_GRADES: CraftGrade[] = ['NG', 'D', 'C', 'B', 'A', 'S'];
export const CRAFT_GRADE_RANK: Record<CraftGrade, number> = {
  NG: 0,
  D: 1,
  C: 2,
  B: 3,
  A: 4,
  S: 5,
};

export interface CraftIngredient {
  name: string;
  qty: number;
  /** data.json catalog id, when the source recipe carried one */
  catalogId: string | null;
}

export interface CraftRecipe {
  /** '70%' | '100%' | '' (material recipes have no craft chance) */
  chance: string;
  outputQty: number;
  ingredients: CraftIngredient[];
  source: 'item' | 'material';
}

export interface CraftEntry {
  id: string;
  name: string;
  kind: string;
  category: CraftCategory;
  grade: CraftGrade | null;
  gradeRank: number;
  section: string;
  icon?: string;
  aliases: string[];
  npcSellPrice?: number;
  recipes: CraftRecipe[];
  craftable: boolean;
}

/** lower-cased, parenthetical-free key used to match names across data sets */
export function normName(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function iconUrl(icon: string | null | undefined): string | undefined {
  if (!icon) return undefined;
  if (/^https?:\/\//.test(icon)) return icon;
  const file = icon.split('/').pop();
  return file ? LOCAL_ICON_DIR + file : undefined;
}

function normGrade(g: unknown): CraftGrade | null {
  const u = String(g ?? '').toUpperCase();
  return (CRAFT_GRADES as string[]).includes(u) ? (u as CraftGrade) : null;
}

/**
 * Many gear rows carry no `grade` of their own but their `section` does, e.g.
 * "weapon-A", "armor-B", "jewelry-C" (Carnage Bow, Barakiel's Axe, …). Fall back
 * to that suffix. Only plain gear sections — "*-parts-A" / "*-recipes-A" don't match.
 */
function sectionGrade(section: string): CraftGrade | null {
  const m = /(?:weapon|armor|jewelry)-(NG|D|C|B|A|S)$/i.exec(section);
  return m ? (m[1].toUpperCase() as CraftGrade) : null;
}

function sectionCategory(section: string, kind: string): CraftCategory {
  const s = section ?? '';
  if (/recipe/i.test(s) || kind === 'recipe') return 'recipe';
  if (/-parts-/i.test(s) || kind === 'part') return 'part';
  if (s.startsWith('weapon')) return 'weapon';
  if (s.startsWith('armor')) return 'armor';
  if (s.startsWith('jewelry')) return 'jewelry';
  if (s.startsWith('resources') || kind === 'resource') return 'resource';
  return 'other';
}

function toRecipe(raw: any, source: 'item' | 'material'): CraftRecipe {
  return {
    chance: String(raw?.craftChance ?? ''),
    outputQty: Number(raw?.outputQty) || 1,
    source,
    ingredients: (raw?.ingredients ?? []).map((i: any) => ({
      name: String(i?.name ?? ''),
      qty: Number(i?.qty) || 0,
      catalogId: i?.catalogId ?? null,
    })),
  };
}

@Injectable({ providedIn: 'root' })
export class CraftCatalogService {
  private http = inject(HttpClient);

  readonly catalog$: Observable<CraftEntry[]> = this.http
    .get<any>('assets/data/data.json')
    .pipe(
      map((data) => this.build(data)),
      catchError(() => of([] as CraftEntry[])),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

  private build(data: any): CraftEntry[] {
    const itemsObj = data?.itemCatalog?.items ?? {};
    const rawItems: any[] = Object.values(itemsObj);

    // recipes carrying ingredient catalogIds — keyed by the produced catalogId
    const recByCat = new Map<string, CraftRecipe[]>();
    const push = (cid: string | null | undefined, r: CraftRecipe) => {
      if (!cid) return;
      const list = recByCat.get(cid) ?? [];
      list.push(r);
      recByCat.set(cid, list);
    };

    for (const r of data?.craft?.itemRecipes ?? data?.itemRecipes ?? []) {
      push(r?.catalogId, toRecipe(r, 'item'));
    }
    for (const r of Object.values<any>(data?.craft?.materialRecipes ?? {})) {
      push(r?.catalogId, toRecipe(r, 'material'));
    }

    const priceObj: Record<string, any> = data?.itemKeyPrice ?? {};

    return rawItems.map((o) => {
      let recipes = recByCat.get(o.id) ?? [];

      // fall back to the recipe embedded on the item (no ingredient catalogIds)
      if (!recipes.length && Array.isArray(o.itemRecipes) && o.itemRecipes.length) {
        recipes = o.itemRecipes.map((r: any) => toRecipe(r, 'item'));
      }
      if (!recipes.length && o.materialRecipe) {
        recipes = [toRecipe(o.materialRecipe, 'material')];
      }

      const grade = normGrade(o.grade) ?? sectionGrade(String(o.section ?? ''));
      return {
        id: String(o.id),
        name: String(o.name ?? ''),
        kind: String(o.kind ?? ''),
        category: sectionCategory(o.section ?? '', o.kind),
        grade,
        gradeRank: grade ? CRAFT_GRADE_RANK[grade] : -1,
        section: String(o.section ?? ''),
        icon: iconUrl(o.icon),
        aliases: Array.isArray(o.aliases) ? o.aliases.map(String) : [],
        npcSellPrice:
          typeof priceObj[o.id]?.npcSellPrice === 'number'
            ? priceObj[o.id].npcSellPrice
            : undefined,
        recipes,
        craftable: recipes.length > 0,
      } satisfies CraftEntry;
    });
  }
}

/** name / alias → entry lookup for resolving recipe ingredients to catalog rows */
export function buildNameIndex(entries: CraftEntry[]): Map<string, CraftEntry> {
  const idx = new Map<string, CraftEntry>();
  for (const e of entries) {
    const keys = [e.name, ...e.aliases];
    for (const k of keys) {
      const n = normName(k);
      if (n && !idx.has(n)) idx.set(n, e);
    }
  }
  return idx;
}
