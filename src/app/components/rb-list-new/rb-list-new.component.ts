import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TableModule } from 'primeng/table';

import { JsonRb, RbJsonDataService } from '../../services/rb-json-data.service';
import { GradeBadgeComponent } from '../shared/grade-badge/grade-badge.component';
import { ChanceBadgeComponent } from '../shared/chance-badge/chance-badge.component';
import { BossStatsComponent } from '../shared/boss-stats/boss-stats.component';

// Read-only catalog browser for the db.json raid-boss list (admin route). Unlike the
// Firestore-backed rb-list this is not editable in place — db.json is a static export,
// not a live store — so this page is just search/filter + a loot-preview dialog.
@Component({
  selector: 'app-rb-list-new',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    TableModule,
    GradeBadgeComponent,
    ChanceBadgeComponent,
    BossStatsComponent,
  ],
  templateUrl: './rb-list-new.component.html',
  styleUrl: './rb-list-new.component.scss',
})
export class RbListNewComponent {
  private destroyRef = inject(DestroyRef);
  private rbJsonData = inject(RbJsonDataService);

  readonly bosses = signal<JsonRb[]>([]);
  readonly loading = signal(true);

  readonly nameQuery = signal('');
  readonly levelFrom = signal<number | null>(null);
  readonly levelTo = signal<number | null>(null);

  readonly selectedBoss = signal<JsonRb | null>(null);

  readonly bossCount = computed(() => this.bosses().length);

  readonly filteredBosses = computed(() => {
    const query = this.nameQuery().trim().toLowerCase();
    const from = this.levelFrom();
    const to = this.levelTo();

    return this.bosses().filter((boss) => {
      const matchesName = !query || (boss.name ?? '').toLowerCase().includes(query);
      const level = boss.level ?? 0;
      const matchesFrom = from == null || level >= from;
      const matchesTo = to == null || level <= to;
      return matchesName && matchesFrom && matchesTo;
    });
  });

  constructor() {
    this.rbJsonData
      .getRaidBosses()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          const sorted = (list ?? [])
            .slice()
            .sort((a, b) => (a?.level ?? 0) - (b?.level ?? 0) || (a?.name ?? '').localeCompare(b?.name ?? ''));
          this.bosses.set(sorted);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  trackById(_index: number, boss: JsonRb): string {
    return boss.id;
  }

  lootCount(boss: JsonRb): number {
    return Array.isArray(boss?.loot) ? boss.loot.length : 0;
  }

  private readonly respColorSteps = [4, 5, 6, 7, 8, 9, 10];

  respBadgeClass(respValue: number | null | undefined): string {
    const value = Math.round(Number(respValue));
    return this.respColorSteps.includes(value) ? `resp-${value}` : 'resp-other';
  }

  resetFilters(): void {
    this.nameQuery.set('');
    this.levelFrom.set(null);
    this.levelTo.set(null);
  }

  openDetails(boss: JsonRb): void {
    this.selectedBoss.set(boss);
  }

  closeDetails(): void {
    this.selectedBoss.set(null);
  }
}
