import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';

import { GradeBadgeComponent } from '../grade-badge/grade-badge.component';

export interface PickerItem {
  name: string;
  icon: string | null;
  grade: string | null;
}

/** «Dagger»-insensitive key: lower case, letters / digits only */
function key(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]/g, '');
}

/** assets/item-icons file names, loaded once (public/assets/item-icons/index.json) */
let iconFiles: Promise<Set<string>> | null = null;
function loadIconFiles(): Promise<Set<string>> {
  iconFiles ??= fetch('assets/item-icons/index.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => new Set((Array.isArray(list) ? list : []).map((x: unknown) => String(x))))
    .catch(() => new Set<string>());
  return iconFiles;
}

/**
 * Modal item picker: search, this boss's drop as tiles, everything else as a
 * list, and «добавить своим названием» when nothing matches. Emits the picked name.
 */
@Component({
  selector: 'app-item-picker',
  standalone: true,
  imports: [FormsModule, DialogModule, GradeBadgeComponent],
  templateUrl: './item-picker.component.html',
  styleUrl: './item-picker.component.scss',
})
export class ItemPickerComponent {
  readonly visible = input(false);
  readonly header = input('Добавить предмет');
  /** «Дроп: <boss>» — null when no boss is picked yet */
  readonly bossName = input<string | null>(null);
  /** this boss's drop table */
  readonly own = input<PickerItem[]>([]);
  /** every other known item */
  readonly rest = input<PickerItem[]>([]);
  /** highlighted tile (the row's current item) */
  readonly current = input<string>('');

  readonly picked = output<string>();
  readonly closed = output<void>();

  readonly query = signal('');
  private readonly files = signal<Set<string>>(new Set());

  constructor() {
    void loadIconFiles().then((s) => this.files.set(s));
  }

  private match(name: string): boolean {
    const q = key(this.query());
    return !q || key(name).includes(q);
  }
  readonly ownHits = computed(() => this.own().filter((o) => this.match(o.name)));
  readonly restHits = computed(() => {
    const ownKeys = new Set(this.own().map((o) => key(o.name)));
    const hits = this.rest().filter((o) => !ownKeys.has(key(o.name)) && this.match(o.name));
    return { items: hits.slice(0, this.query().trim() ? 120 : 60), total: hits.length };
  });
  readonly canAddCustom = computed(() => {
    const q = key(this.query());
    return !!q && ![...this.own(), ...this.rest()].some((o) => key(o.name) === q);
  });
  isCurrent(name: string): boolean {
    return !!this.current() && key(name) === key(this.current());
  }

  /** «Demon's Dagger» → demon-dagger.webp etc., when the item has no picture of its own */
  iconOf(o: PickerItem): string | null {
    if (o.icon) return o.icon;
    const files = this.files();
    if (!files.size) return null;
    const base = o.name.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/:/g, ' ');
    const slug = (s: string) => s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    for (const c of [slug(base.replace(/'s\b/g, 's')), slug(base.replace(/'s\b/g, '')), slug(base.replace(/'/g, ''))]) {
      for (const ext of ['webp', 'png', 'jpg']) if (files.has(`${c}.${ext}`)) return `assets/item-icons/${c}.${ext}`;
    }
    return null;
  }

  pick(name: string): void {
    const n = name.trim();
    if (!n) return;
    this.picked.emit(n);
    this.query.set('');
  }
  pickFirst(): void {
    const first = this.ownHits()[0] ?? this.restHits().items[0];
    if (first) this.pick(first.name);
    else if (this.canAddCustom()) this.pick(this.query());
  }
  close(): void {
    this.query.set('');
    this.closed.emit();
  }
}
