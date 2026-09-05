import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';

/**
 * Tracks, per Firebase Auth uid, which step-by-step in-app tours the user has
 * already finished (or explicitly skipped) — so a guided tour only ever shows
 * once per person, not once per browser (localStorage would reset on a new
 * device/profile). One doc per user in `user-onboarding`, one boolean field
 * per tour id (e.g. "bookmarks") so future tours on other pages can reuse the
 * same doc without clobbering each other.
 */
@Injectable({
  providedIn: 'root',
})
export class OnboardingService {
  private firestore = inject(Firestore);

  async hasCompletedTour(uid: string, tourId: string): Promise<boolean> {
    if (!uid) return true; // no user yet — don't show a tour to a logged-out view
    try {
      const snap = await getDoc(doc(this.firestore, `user-onboarding/${uid}`));
      const data = snap.data() as Record<string, unknown> | undefined;
      return !!data?.[tourId];
    } catch {
      // if we can't tell, don't nag every reload with a broken tour
      return true;
    }
  }

  async markTourDone(uid: string, tourId: string, skipped: boolean): Promise<void> {
    if (!uid) return;
    try {
      await setDoc(
        doc(this.firestore, `user-onboarding/${uid}`),
        { [tourId]: true, [`${tourId}At`]: Date.now(), [`${tourId}Skipped`]: skipped },
        { merge: true },
      );
    } catch {
      // best-effort — worst case the tour shows again next time
    }
  }
}
