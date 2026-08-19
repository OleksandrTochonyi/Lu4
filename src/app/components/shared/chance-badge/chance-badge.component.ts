import { CommonModule } from '@angular/common';
import { Component, computed, input } from '@angular/core';

// Small pill showing a drop chance, rounded to hundredths of a percent (e.g. 12.34%).
// Color-coded by rarity so a glance at the loot list tells common drops from rare
// ones, without reading every number. Renders nothing when chance is unknown.
@Component({
  selector: 'app-chance-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chance-badge.component.html',
  styleUrl: './chance-badge.component.scss',
})
export class ChanceBadgeComponent {
  chance = input<number | null | undefined>(null);

  label = computed<string | null>(() => {
    const value = this.chance();
    if (value == null || !Number.isFinite(value)) return null;
    return `${value.toFixed(2)}%`;
  });

  rarityClass = computed<string>(() => {
    const value = this.chance();
    if (value == null || !Number.isFinite(value)) return '';
    if (value < 0.1) return 'chance-rare';
    if (value < 1) return 'chance-uncommon';
    if (value < 10) return 'chance-common';
    return 'chance-frequent';
  });
}
