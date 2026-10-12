import { Injectable, inject, signal } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import { Firestore, doc, docData, setDoc } from '@angular/fire/firestore';
import { catchError, of, switchMap } from 'rxjs';

/** tracks live here; `index.json` lists them (a browser can't list a folder) */
const TRACKS_ROOT = '/assets/voice/users-joke/';
/** the one doc everybody listens to */
const BROADCAST_DOC = 'site-broadcast/sound';
/** only this account gets the «play for everyone» panel */
export const BROADCAST_OWNER = 'alexadmin@gmail.com';
/** a broadcast older than this (page opened later, sleeping tab) is not played */
const MAX_LATE_MS = 30_000;

export interface JokeTrack {
  file: string;
  label: string;
}

/**
 * «Воспроизвести у всех»: the owner writes {file, at, nonce} to one Firestore doc;
 * every open client is subscribed and plays that track as soon as the doc changes.
 *
 * Browsers only allow sound after the user has clicked/typed on the page at least
 * once — a tab nobody has touched stays silent.
 */
@Injectable({ providedIn: 'root' })
export class BroadcastSoundService {
  private firestore = inject(Firestore);
  private auth = inject(Auth);

  readonly tracks = signal<JokeTrack[]>([]);
  /** what was broadcast last (for the panel) */
  readonly last = signal<{ label: string; at: number; by: string } | null>(null);

  private started = false;
  private seenNonce: string | null = null;
  private firstSnap = true;
  private current: HTMLAudioElement | null = null;

  constructor() {
    void fetch(`${TRACKS_ROOT}index.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) =>
        this.tracks.set(
          (Array.isArray(list) ? list : [])
            .map((t: any) => ({ file: String(t?.file ?? ''), label: String(t?.label ?? t?.file ?? '') }))
            .filter((t: JokeTrack) => t.file),
        ),
      )
      .catch(() => null);
  }

  get isOwner(): boolean {
    return (this.auth.currentUser?.email ?? '').toLowerCase() === BROADCAST_OWNER;
  }

  /** call once (AppComponent) — listens while signed in */
  start(): void {
    if (this.started) return;
    this.started = true;
    authState(this.auth)
      .pipe(
        switchMap((u) => {
          this.firstSnap = true;
          return u ? docData(doc(this.firestore, BROADCAST_DOC)).pipe(catchError(() => of(null))) : of(null);
        }),
      )
      .subscribe((d: any) => this.onBroadcast(d));
  }

  private onBroadcast(d: any): void {
    if (!d?.file) {
      this.firstSnap = false;
      return;
    }
    const at = Number(d.at) || 0;
    this.last.set({ label: String(d.label ?? d.file), at, by: String(d.by ?? '') });
    const nonce = String(d.nonce ?? at);
    const first = this.firstSnap;
    this.firstSnap = false;
    if (nonce === this.seenNonce) return;
    this.seenNonce = nonce;
    // the doc already holding an old broadcast when the page opens → don't replay it
    if (first && Date.now() - at > 5_000) return;
    if (Date.now() - at > MAX_LATE_MS) return;
    this.playLocal(String(d.file));
  }

  /** just here, for the owner to preview */
  playLocal(file: string): void {
    try {
      this.current?.pause();
      const a = new Audio(TRACKS_ROOT + encodeURIComponent(file));
      this.current = a;
      void a.play().catch(() => null);
    } catch {
      /* no audio */
    }
  }

  /** play for everyone who has the site open (and for us, via the same listener) */
  async broadcast(track: JokeTrack): Promise<void> {
    if (!this.isOwner) throw new Error('Нет доступа');
    await setDoc(doc(this.firestore, BROADCAST_DOC), {
      file: track.file,
      label: track.label,
      at: Date.now(),
      by: this.auth.currentUser?.email ?? '',
      nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
  }
}
