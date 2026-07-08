import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  setDoc,
} from '@angular/fire/firestore';
import { Observable, firstValueFrom } from 'rxjs';

const API_BASE = 'https://l2api.dev/api/interlude';

export interface Item {
  id: string;
  name: string;
  type: string;
  grade: string;
  weight: number;
  price: number;
  iconFile: string;
}

interface ItemsApiResponse {
  data: Array<Omit<Item, 'id'> & { id: number }>;
  meta: { total: number; limit: number; offset: number };
}

/** Grade sort weight: higher = better grade. */
export const GRADE_ORDER: Record<string, number> = {
  s: 5,
  a: 4,
  b: 3,
  c: 2,
  d: 1,
  none: 0,
};

@Injectable({
  providedIn: 'root',
})
export class ItemsService {
  private http = inject(HttpClient);
  private firestore = inject(Firestore);
  private itemsCollection = collection(this.firestore, 'items');

  /** GET: stream of all items from Firestore. */
  getItems(): Observable<Item[]> {
    return collectionData(this.itemsCollection, { idField: 'id' }) as Observable<Item[]>;
  }

  /** Fetch a single page of items from the API. */
  private fetchPage(type: string, limit: number, offset: number): Promise<ItemsApiResponse> {
    const url = `${API_BASE}/items?limit=${limit}&offset=${offset}&type=${type}`;
    return firstValueFrom(this.http.get<ItemsApiResponse>(url));
  }

  /**
   * Fetch every item of a given type from the API (all pages) and store them
   * in the Firestore "items" collection (doc id = item id).
   * Returns the number of imported items.
   */
  async importItemsFromApi(type = 'etcitem', pageSize = 200): Promise<number> {
    let offset = 0;
    let total = Infinity;
    let saved = 0;

    while (offset < total) {
      const res = await this.fetchPage(type, pageSize, offset);
      total = res.meta.total;

      if (!res.data.length) break;

      for (const item of res.data) {
        const ref = doc(this.itemsCollection, String(item.id));
        await setDoc(ref, {
          name: item.name,
          type: item.type,
          grade: item.grade,
          weight: item.weight ?? 0,
          price: item.price ?? 0,
          iconFile: item.iconFile,
        });
        saved++;
      }

      console.log(`[items import] saved ${saved}/${total}`);
      offset += res.meta.limit;
    }

    console.log(`[items import] DONE. total saved: ${saved}`);
    return saved;
  }
}
