import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData, doc, setDoc, deleteDoc } from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';

export interface JsonMapPosition {
  id: string;
  mapX: number;
  mapY: number;
}

// Manual map placements for db.json raid bosses, kept in their own Firestore collection
// so they never mix with the legacy `raid-boss` collection the old pages still read from.
// Doc id = the db.json monster id. Takes priority over RbJsonDataService's name-matched
// fallback position (see RbJsonDataService.getRaidBosses()).
@Injectable({
  providedIn: 'root',
})
export class RbJsonMapService {
  private firestore = inject(Firestore);
  private positionsCollection = collection(this.firestore, 'raid-boss-json-map');

  /** Map of db.json monster id -> manually placed {x, y} (percent, 0-100). */
  getPositions(): Observable<Map<string, { x: number; y: number }>> {
    return (collectionData(this.positionsCollection, { idField: 'id' }) as Observable<JsonMapPosition[]>).pipe(
      map((rows) => {
        const result = new Map<string, { x: number; y: number }>();
        for (const row of rows ?? []) {
          if (typeof row.mapX === 'number' && typeof row.mapY === 'number') {
            result.set(row.id, { x: row.mapX, y: row.mapY });
          }
        }
        return result;
      })
    );
  }

  setPosition(jsonBossId: string, x: number, y: number): Promise<void> {
    const id = (jsonBossId ?? '').trim();
    if (!id) throw new Error('jsonBossId is required');

    const clamp = (v: number) => Math.min(100, Math.max(0, Number(v) || 0));
    const ref = doc(this.firestore, `raid-boss-json-map/${id}`);
    return setDoc(ref, { mapX: clamp(x), mapY: clamp(y) });
  }

  clearPosition(jsonBossId: string): Promise<void> {
    const id = (jsonBossId ?? '').trim();
    if (!id) throw new Error('jsonBossId is required');

    const ref = doc(this.firestore, `raid-boss-json-map/${id}`);
    return deleteDoc(ref);
  }
}
