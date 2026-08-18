// Shared "hidden raid boss" preference — a plain per-browser localStorage set,
// keyed by raid-boss id (or name as a fallback). Used by every page that lists
// raid bosses so hiding one is consistent app-wide.
const LS_HIDDEN_IDS = 'rb-hidden-ids';

export function getRbKey(item: any): string {
  const id = item?.id;
  if (id != null) return String(id);
  return String(item?.name ?? item?.displayName ?? '');
}

export function readHiddenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_HIDDEN_IDS);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

export function writeHiddenIds(ids: Set<string>): void {
  try {
    localStorage.setItem(LS_HIDDEN_IDS, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore storage errors
  }
}
