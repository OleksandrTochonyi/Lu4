import { Injectable } from '@angular/core';

/**
 * No backend, so the browser asks a public echo service for its own IP. Cached for
 * a while (an IP can change mid-session, e.g. on mobile); a failed/blocked lookup
 * resolves to '' and is retried on the next call. Client-supplied, so it can be
 * spoofed — fine for "who logged in from where", not as proof.
 */
const IP_URL = 'https://api.ipify.org?format=json';
const IP_TTL_MS = 10 * 60 * 1000;
const IP_TIMEOUT_MS = 3000;

@Injectable({ providedIn: 'root' })
export class IpService {
  private cached: { value: string; at: number } | null = null;
  private pending: Promise<string> | null = null;

  /** current public IP, '' if the lookup fails — never throws */
  get(): Promise<string> {
    if (this.cached && Date.now() - this.cached.at < IP_TTL_MS) {
      return Promise.resolve(this.cached.value);
    }
    if (this.pending) return this.pending;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IP_TIMEOUT_MS);
    this.pending = fetch(IP_URL, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const value = String(j?.ip ?? '').slice(0, 64);
        if (value) this.cached = { value, at: Date.now() };
        return value || this.cached?.value || '';
      })
      .catch(() => this.cached?.value ?? '')
      .finally(() => {
        clearTimeout(timer);
        this.pending = null;
      });
    return this.pending;
  }
}
