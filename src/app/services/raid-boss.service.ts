import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  setDoc,
  updateDoc,
  deleteDoc,
  DocumentReference,
} from '@angular/fire/firestore';
import { Timestamp } from 'firebase/firestore';
import { Observable, firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

export interface RaidBossMeta {
  imageUrl: string;
  infoLink: string;
  plusMinusRespTime: number;
  respTime: number;
}

export interface RaidBoss {
  id: string;
  name: string;
  title: string;
  level: number;
  npcType: string;
  hp: number;
  isAggressive: boolean;
  meta?: RaidBossMeta;
  lastDeadTime?: Timestamp | null;
  loot?: DocumentReference[];
}

export interface RaidBossInput {
  name: string;
  level: number;
  meta: RaidBossMeta;
  lastDeadTime: Date | null;
  lootItemIds: string[];
}

const DEFAULT_META: RaidBossMeta = {
  imageUrl: '',
  infoLink: '',
  plusMinusRespTime: 4,
  respTime: 8,
};

@Injectable({
  providedIn: 'root',
})
export class RaidBossService {
  private firestore = inject(Firestore);
  private raidBossCollection = collection(this.firestore, 'raid-boss');

  /** GET: stream of all raid bosses. */
  getRaidBosses(): Observable<RaidBoss[]> {
    return collectionData(this.raidBossCollection, { idField: 'id' }) as Observable<RaidBoss[]>;
  }

  /** GET: stream of a single raid boss by id. */
  getRaidBoss(id: string): Observable<RaidBoss> {
    const ref = doc(this.firestore, `raid-boss/${id}`);
    return docData(ref, { idField: 'id' }) as Observable<RaidBoss>;
  }

  /** DELETE: remove a raid boss document. */
  deleteRaidBoss(id: string): Promise<void> {
    const rbId = (id ?? '').trim();
    if (!rbId) throw new Error('raid boss id is required');

    const ref = doc(this.firestore, `raid-boss/${rbId}`);
    return deleteDoc(ref);
  }

  /** PUT: update arbitrary fields of a raid boss. */
  updateRaidBoss(id: string, data: Partial<Omit<RaidBoss, 'id'>>): Promise<void> {
    const rbId = (id ?? '').trim();
    if (!rbId) throw new Error('raid boss id is required');

    const ref = doc(this.firestore, `raid-boss/${rbId}`);
    return updateDoc(ref, { ...data });
  }

  /** PUT: upsert a raid boss document (merge write). */
  saveRaidBoss(id: string, boss: Partial<Omit<RaidBoss, 'id'>>): Promise<void> {
    const rbId = (id ?? '').trim();
    if (!rbId) throw new Error('raid boss id is required');

    const ref = doc(this.firestore, `raid-boss/${rbId}`);
    return setDoc(ref, boss, { merge: true });
  }

  /** PUT: create or fully update a raid boss from a plain form input. */
  upsertRaidBoss(id: string, input: RaidBossInput): Promise<void> {
    const rbId = (id ?? '').trim();
    if (!rbId) throw new Error('raid boss id is required');

    const ref = doc(this.firestore, `raid-boss/${rbId}`);
    return setDoc(ref, this.buildRaidBossDoc(input), { merge: true });
  }

  /** POST: create a raid boss with an auto-generated id. Returns the new id. */
  async createRaidBoss(input: RaidBossInput): Promise<string> {
    const ref = doc(this.raidBossCollection);
    await setDoc(ref, this.buildRaidBossDoc(input));
    return ref.id;
  }

  private buildRaidBossDoc(input: RaidBossInput): Record<string, any> {
    const loot = (input.lootItemIds ?? [])
      .map((itemId) => (itemId ?? '').trim())
      .filter(Boolean)
      .map((itemId) => doc(this.firestore, `items/${itemId}`));

    return {
      name: input.name,
      level: input.level,
      meta: input.meta,
      lastDeadTime: input.lastDeadTime ? Timestamp.fromDate(input.lastDeadTime) : null,
      loot,
    };
  }

  /** PUT: replace the whole meta object. */
  setMeta(id: string, meta: RaidBossMeta): Promise<void> {
    return this.updateRaidBoss(id, { meta });
  }

  /** PUT: update individual meta fields without overwriting the rest. */
  updateMeta(id: string, meta: Partial<RaidBossMeta>): Promise<void> {
    const rbId = (id ?? '').trim();
    if (!rbId) throw new Error('raid boss id is required');

    const payload: Record<string, any> = {};
    for (const [key, value] of Object.entries(meta)) {
      payload[`meta.${key}`] = value;
    }

    const ref = doc(this.firestore, `raid-boss/${rbId}`);
    return updateDoc(ref, payload);
  }

  /** PUT: set the last kill time (or clear it with null). */
  setKillTime(id: string, killTime: Date | null): Promise<void> {
    return this.updateRaidBoss(id, {
      lastDeadTime: killTime ? Timestamp.fromDate(killTime) : null,
    });
  }

  /** PUT: set loot as references to items/{itemId}. */
  setLoot(id: string, itemIds: string[]): Promise<void> {
    const lootRefs = (itemIds ?? [])
      .map((itemId) => (itemId ?? '').trim())
      .filter(Boolean)
      .map((itemId) => doc(this.firestore, `items/${itemId}`));

    return this.updateRaidBoss(id, { loot: lootRefs });
  }

  /**
   * Ensure every raid boss has the editable fields (meta / lastDeadTime / loot)
   * so they can be filled in later. Existing values are preserved.
   */
  async ensureMetaForAll(defaults: Partial<RaidBossMeta> = {}): Promise<number> {
    const bosses = await firstValueFrom(this.getRaidBosses().pipe(take(1)));

    const meta: RaidBossMeta = { ...DEFAULT_META, ...defaults };

    for (const boss of bosses) {
      const ref = doc(this.firestore, `raid-boss/${boss.id}`);
      await setDoc(
        ref,
        {
          meta: boss.meta ?? meta,
          lastDeadTime: boss.lastDeadTime ?? null,
          loot: boss.loot ?? [],
        },
        { merge: true }
      );
    }

    return bosses.length;
  }
}
