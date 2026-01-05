import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { AvatarModule } from 'primeng/avatar';
import { BadgeModule } from 'primeng/badge';
import { InputTextModule } from 'primeng/inputtext';
import { MenubarModule } from 'primeng/menubar';
import { RippleModule } from 'primeng/ripple';
import { ToastModule } from 'primeng/toast';

import { RbOverviewComponent } from './components/rb-overview/rb-overview.component';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'app-root',
    imports: [
        CommonModule,
        MenubarModule,
        BadgeModule,
        InputTextModule,
        AvatarModule,
        RippleModule,
        ToastModule,
        RbOverviewComponent,
    ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
      items: MenuItem[] | undefined;

    ngOnInit() {
        this.items = [
            {
                label: 'Home',
                icon: 'pi pi-home',
            },
            {
                label: 'Projects',
                icon: 'pi pi-search',
            },
        ];
    }
}
