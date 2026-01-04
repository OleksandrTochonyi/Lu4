import { Injectable } from '@angular/core';
import { Firestore, collectionData, collection, DocumentReference, docData } from '@angular/fire/firestore';
import { Observable, catchError, forkJoin, map, of, switchMap, take, throwError } from 'rxjs';

export interface Item {
  id?: string;
  name: string;
  value: string;
}

@Injectable({
  providedIn: 'root'
})
export class RbData {
  constructor(private firestore: Firestore) {}

getItems(): Observable<any[]> {
  console.log('Fetching items from Firestore...');
  const entitiesCollection = collection(this.firestore, 'rb-data');

  return collectionData(entitiesCollection, { idField: 'id' }).pipe(
    switchMap((entities: any[]) => {
      if (!entities.length) {
        return of([]);
      }

      const observables = entities.map(entity => {
        if (Array.isArray(entity.loot) && entity.loot.length) {
          const lootObservables = entity.loot.map((ref: any) => {
            if (!ref) return of(null);

            return docData<any>(ref, { idField: 'id' }).pipe(take(1));
          });

          return forkJoin(lootObservables).pipe(
            map((lootData:any) => ({
              ...entity,
              loot: lootData
            }))
          );
        } else {
          return of({ ...entity, loot: [] });
        }
      });

      return forkJoin(observables);
    })
  );
}
}
