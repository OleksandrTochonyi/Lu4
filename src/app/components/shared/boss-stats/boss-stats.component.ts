import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';

import { JsonRbStats } from '../../../services/rb-json-data.service';

// Groups a boss's raw db.json stats into three visually distinct kinds, since they
// mean different things: HP (survivability) gets its own emphasized block, P.Atk/
// M.Atk/P.Def/M.Def (combat power) are grouped together, and EXP/SP (kill reward)
// are grouped together — instead of one flat, undifferentiated grid.
@Component({
  selector: 'app-boss-stats',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './boss-stats.component.html',
  styleUrl: './boss-stats.component.scss',
})
export class BossStatsComponent {
  stats = input<JsonRbStats | null | undefined>(null);
}
