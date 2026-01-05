import { Component, input, output } from '@angular/core';
import { DataViewModule } from 'primeng/dataview';
import { RbItemComponent } from './components/rb-item/rb-item.component';

@Component({
  selector: 'app-rb-list',
  standalone: true,
  imports: [DataViewModule, RbItemComponent],
  templateUrl: './rb-list.component.html',
  styleUrl: './rb-list.component.scss',
})
export class RbListComponent {
  items = input<any[]>([]);
  showDetails = input(true);
  deadTimeDraftChanged = output<{ rb: any; deadTime: Date | null }>();
  deadTimeChanged = output<{ rb: any; deadTime: Date | null }>();
}
