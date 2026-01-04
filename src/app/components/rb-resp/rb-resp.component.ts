import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

import { RbRespListComponent } from './components/rb-resp-list/rb-resp-list.component';
import { RbRespCardsComponent } from './components/rb-resp-cards/rb-resp-cards.component';

@Component({
  selector: 'app-rb-resp',
  standalone: true,
  imports: [CommonModule, RbRespListComponent, RbRespCardsComponent],
  templateUrl: './rb-resp.component.html',
  styleUrls: ['./rb-resp.component.scss'],
})
export class RbRespComponent {}
