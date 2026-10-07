import { Injectable, signal } from '@angular/core';

const LS_MIRROR = 'rb-mirror-ng';

/**
 * «Дублировать в NG» (switch on the Bookmarks page, remembered per browser):
 * when on, every kill time WE set (bookmarks: set / edit / rollback, raids
 * «Пометить как убитый», the map) is also written to Bookmarks NG.
 * Done centrally in RbJsonRespService.setKillTime.
 */
@Injectable({ providedIn: 'root' })
export class NgMirrorService {
  readonly enabled = signal(read());

  setEnabled(on: boolean): void {
    this.enabled.set(on);
    try {
      localStorage.setItem(LS_MIRROR, on ? '1' : '0');
    } catch {
      /* ignore */
    }
  }
}

function read(): boolean {
  try {
    return localStorage.getItem(LS_MIRROR) === '1';
  } catch {
    return false;
  }
}
