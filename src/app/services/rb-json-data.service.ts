import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { Observable, combineLatest, map, shareReplay } from 'rxjs';

import { RaidBossService } from './raid-boss.service';
import { RbJsonMapService } from './rb-json-map.service';
import { RbJsonRespService, RespHistoryEntry } from './rb-json-resp.service';

// Static image host for drop icons stored in db.json ("imageUrl" there is a
// site-relative path, e.g. "/media/site/img/....webp").
const IMAGE_HOST = 'https://lu4db.ru';

// Grade order, highest first — used to sort loot and by the grade badge palette.
const GRADE_SORT_ORDER: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1, NG: 0 };

export interface JsonDrop {
  name: string;
  qty: number | string;
  chance: number;
  section?: string;
  imageUrl?: string;
  grade?: string;
}

interface DbMonster {
  id: string;
  name: string;
  level: number;
  minResp?: number;
  plusResp?: number;
  locations?: string[];
  hp?: number;
  patk?: number;
  matk?: number;
  pdef?: number;
  mdef?: number;
  exp?: number;
  sp?: number;
  skills?: string[];
  drop?: JsonDrop[];
  spoil?: JsonDrop[];
}

interface DbFile {
  version: number;
  generatedAt: string;
  monsters: DbMonster[];
}

export interface JsonRbLoot {
  displayName: string;
  imgUrl: string;
  grade?: string;
  chance?: number;
  qty?: number | string;
}

export interface JsonRbStats {
  minResp?: number;
  plusResp?: number;
  hp?: number;
  patk?: number;
  matk?: number;
  pdef?: number;
  mdef?: number;
  exp?: number;
  sp?: number;
}

// Shape mirrors what the Firestore-backed RbData.getItems() produces (id, displayName,
// lvl, loot[]), so the same downstream UI patterns (search/level filters, loot popovers)
// keep working against either source.
export interface JsonRb {
  id: string;
  name: string;
  displayName: string;
  level: number;
  lvl: number;
  locations: string[];
  loot: JsonRbLoot[];
  stats: JsonRbStats;
  /** Position on the shared map image (percent, 0-100), if this boss could be matched
   *  by name to a positioned boss in the Firestore raid-boss collection, or has a
   *  manually placed point of its own. */
  mapX?: number;
  mapY?: number;
  /** Where mapX/mapY came from — a manual placement always wins over the name match. */
  mapSource?: 'manual' | 'matched';
  /** Kill time from the rb-resp-time collection (this catalog's own store — see
   *  RbJsonRespService), and the last few previous values with who/when changed them. */
  lastDeadTime?: Timestamp | null;
  respHistory?: RespHistoryEntry[];
}

function resolveImageUrl(path?: string): string {
  if (!path) return '';
  return `${IMAGE_HOST}${path}`;
}

function gradeRank(grade?: string): number {
  return GRADE_SORT_ORDER[String(grade ?? '').toUpperCase()] ?? -1;
}

// Enchant scrolls sort as their own group at the very bottom of the loot list,
// below even ungraded items — grade doesn't really describe them the way it
// describes equipment, and grouping them keeps a long drop list scannable.
function isEnchantScroll(name: string): boolean {
  return String(name ?? '').includes('Scroll: Enchant');
}

@Injectable({
  providedIn: 'root',
})
export class RbJsonDataService {
  private http = inject(HttpClient);
  private raidBossService = inject(RaidBossService);
  private jsonMapService = inject(RbJsonMapService);
  private jsonRespService = inject(RbJsonRespService);

  private raidBosses$ = combineLatest([
    this.http.get<DbFile>('assets/data/db.json'),
    this.raidBossService.getRaidBosses(),
    this.jsonMapService.getPositions(),
    this.jsonRespService.getRespTimes(),
  ]).pipe(
    map(([db, firestoreBosses, manualPositions, respTimes]) => {
      const monsters = (db?.monsters ?? []).map((monster) => this.mapMonster(monster));
      const matchedPositions = this.matchPositions(monsters, firestoreBosses ?? []);

      return monsters.map((monster) => {
        let result = monster;

        // A manually placed point (via the JSON map's "add point" flow) always wins
        // over the name-matched fallback from the legacy raid-boss collection.
        const manual = manualPositions.get(monster.id);
        if (manual) {
          result = { ...result, mapX: manual.x, mapY: manual.y, mapSource: 'manual' as const };
        } else {
          const matched = matchedPositions.get(monster.id);
          if (matched) result = { ...result, mapX: matched.x, mapY: matched.y, mapSource: 'matched' as const };
        }

        const resp = respTimes.get(monster.id);
        if (resp) {
          result = { ...result, lastDeadTime: resp.killTime ?? null, respHistory: resp.history ?? [] };
        }

        return result;
      });
    }),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /**
   * Static raid-boss catalog sourced from assets/data/db.json.
   * `mapX`/`mapY` are filled in from a manual placement (raid-boss-json-map collection)
   * when one exists, else opportunistically from the Firestore raid-boss docs' map
   * placement matched by name. `lastDeadTime`/`respHistory` come from the rb-resp-time
   * collection (this catalog's own kill-time store, separate from the legacy one).
   */
  getRaidBosses(): Observable<JsonRb[]> {
    return this.raidBosses$;
  }

  private mapMonster(monster: DbMonster): JsonRb {
    return {
      id: monster.id,
      name: monster.name,
      displayName: monster.name,
      level: monster.level,
      lvl: monster.level,
      locations: monster.locations ?? [],
      loot: (monster.drop ?? [])
        .map((d) => ({
          displayName: d.name,
          imgUrl: resolveImageUrl(d.imageUrl),
          grade: d.grade,
          chance: d.chance,
          qty: d.qty,
        }))
        .sort((a, b) => {
          const aScroll = isEnchantScroll(a.displayName);
          const bScroll = isEnchantScroll(b.displayName);
          if (aScroll !== bScroll) return aScroll ? 1 : -1;
          return gradeRank(b.grade) - gradeRank(a.grade);
        }),
      stats: {
        minResp: monster.minResp,
        plusResp: monster.plusResp,
        hp: monster.hp,
        patk: monster.patk,
        matk: monster.matk,
        pdef: monster.pdef,
        mdef: monster.mdef,
        exp: monster.exp,
        sp: monster.sp,
      },
    };
  }

  // ---------- Name matching (Firestore raid-boss docs -> db.json monsters) ----------

  private normalizeName(name: string): string {
    return String(name ?? '')
      .toLowerCase()
      .replace(/\[[^\]]*\]/g, ' ') // strip bracketed tags, e.g. "[52]", "[GoE]"
      .replace(/raid boss/gi, ' ')
      .replace(/[^a-zа-яё0-9]+/gi, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private matchPositions(
    jsonBosses: JsonRb[],
    firestoreBosses: any[]
  ): Map<string, { x: number; y: number }> {
    const placed = (firestoreBosses ?? []).filter(
      (b) => typeof b?.mapX === 'number' && typeof b?.mapY === 'number' && b?.name
    );
    const firestoreEntries = placed.map((b) => ({
      normalized: this.normalizeName(b.name),
      x: b.mapX as number,
      y: b.mapY as number,
    }));

    const result = new Map<string, { x: number; y: number }>();

    for (const boss of jsonBosses) {
      const normalized = this.normalizeName(boss.name);
      if (!normalized) continue;

      const exact = firestoreEntries.find((f) => f.normalized === normalized);
      if (exact) {
        result.set(boss.id, { x: exact.x, y: exact.y });
        continue;
      }

      // Fuzzy fallback: only accept a substring match when exactly one candidate
      // qualifies, to avoid silently picking the wrong boss when names collide.
      const candidates = firestoreEntries.filter(
        (f) => f.normalized.includes(normalized) || normalized.includes(f.normalized)
      );
      if (candidates.length === 1) {
        result.set(boss.id, { x: candidates[0].x, y: candidates[0].y });
      }
    }

    return result;
  }
}
