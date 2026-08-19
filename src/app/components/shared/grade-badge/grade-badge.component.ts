import { CommonModule } from '@angular/common';
import { Component, computed, input } from '@angular/core';

// Small colored pill for an item's grade: NG grey, D blue, C green, B yellow,
// A silver, S gold. Renders nothing when the grade is unknown/missing.
@Component({
  selector: 'app-grade-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './grade-badge.component.html',
  styleUrl: './grade-badge.component.scss',
})
export class GradeBadgeComponent {
  grade = input<string | null | undefined>(null);

  private readonly knownGrades = new Set(['NG', 'D', 'C', 'B', 'A', 'S']);

  normalizedGrade = computed(() => {
    const value = String(this.grade() ?? '').trim().toUpperCase();
    return this.knownGrades.has(value) ? value : null;
  });
}
