import { Injectable, signal } from '@angular/core';

const LS_THEME = 'app-theme';
export const DARK_CLASS = 'app-dark';

/**
 * Light / dark switch, remembered per browser. Dark mode is a whole-page
 * invert filter (see `html.app-dark` in styles.scss) rather than a hand-made
 * palette: ~1500 hard-coded light colours across the component styles would
 * each need a dark twin. Pictures (icons, the map, the paperdoll) are inverted
 * back so they keep their real colours.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly dark = signal(this.read());
  /** false on /login — its photo background isn't worth special-casing */
  private allowed = true;

  constructor() {
    this.apply();
  }

  toggle(): void {
    this.dark.update((v) => !v);
    try {
      localStorage.setItem(LS_THEME, this.dark() ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
    this.apply();
  }

  setAllowed(allowed: boolean): void {
    this.allowed = allowed;
    this.apply();
  }

  private apply(): void {
    document.documentElement.classList.toggle(DARK_CLASS, this.dark() && this.allowed);
  }

  private read(): boolean {
    try {
      return localStorage.getItem(LS_THEME) === 'dark';
    } catch {
      return false;
    }
  }
}
