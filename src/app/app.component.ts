import { CommonModule, Location } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import {
  NavigationEnd,
  Router,
  RouterModule,
  RouterOutlet,
  UrlTree,
} from '@angular/router';
import { AvatarModule } from 'primeng/avatar';
import { BadgeModule } from 'primeng/badge';
import { InputTextModule } from 'primeng/inputtext';
import { MenubarModule } from 'primeng/menubar';
import { RippleModule } from 'primeng/ripple';
import { ToastModule } from 'primeng/toast';
import { MenuItem } from 'primeng/api';
import { combineLatest } from 'rxjs';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthService } from './services/auth.service';
import { isWarehouseEmail } from './data/warehouse-access';

@Component({
  selector: 'app-root',
  imports: [
    CommonModule,
    RouterOutlet,
    RouterModule,
    MenubarModule,
    BadgeModule,
    InputTextModule,
    AvatarModule,
    RippleModule,
    ToastModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private router = inject(Router);
  private authService = inject(AuthService);
  private location = inject(Location);
  private destroyRef = inject(DestroyRef);

  private currentUrl = this.location.path(true) || this.router.url;

  items: MenuItem[] | undefined;

  get isLoginPage(): boolean {
    const url = this.currentUrl || this.location.path(true) || this.router.url;
    return (
      url === '/login' || url.startsWith('/login?') || url.startsWith('/login/')
    );
  }

  get showMenubar(): boolean {
    if (this.isLoginPage) return false;

    // Prevent a brief flash of the menubar when landing on '/' and being redirected
    // to '/login' (e.g. user not authenticated / no stored credentials).
    const url = this.currentUrl || this.location.path(true) || this.router.url;
    const isRoot = url === '' || url === '/';
    const hasStoredCreds = this.authService.getStoredCredentials() != null;
    if (isRoot && !hasStoredCreds) return false;

    return true;
  }

  private readonly allMenuItems: (MenuItem & {
    adminOnly?: boolean;
    warehouseOnly?: boolean;
  })[] = [
    {
      label: 'Bookmarks',
      icon: 'pi pi-bookmark',
      routerLink: '/',
    },
    {
      label: 'RB Map',
      icon: 'pi pi-map',
      routerLink: '/rb-map-new',
    },
    {
      label: 'RB List',
      icon: 'pi pi-list',
      routerLink: '/rb-list-new',
      adminOnly: true,
    },
    {
      label: 'Clan Info',
      icon: 'pi pi-users',
      routerLink: '/users',
    },
    {
      label: 'WH',
      icon: 'pi pi-box',
      routerLink: '/warehouse',
      warehouseOnly: true,
    },
    {
      label: 'Raids',
      icon: 'pi pi-book',
      routerLink: '/raids',
      adminOnly: true,
    },
    // {
    //   label: 'RB List',
    //   icon: 'pi pi-list',
    //   routerLink: '/rb-list',
    //   adminOnly: true,
    // },
    {
      label: 'Statistics',
      icon: 'pi pi-chart-bar',
      routerLink: '/startistics',
      adminOnly: true,
    },
  ];

  ngOnInit() {
    this.authService.tryAutoLoginFromStorage();

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e) => {
        this.currentUrl = e.urlAfterRedirects;
      });

    combineLatest([this.authService.isAdmin$, this.authService.user$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([isAdmin, user]) => {
        const canWarehouse = isAdmin || isWarehouseEmail(user?.email);
        this.items = this.allMenuItems.filter(
          (item) =>
            (isAdmin || !item.adminOnly) && (canWarehouse || !item.warehouseOnly),
        );
      });
  }

  onMenuClick(item: MenuItem, event: Event): void {
    const link = (item as any)?.routerLink as unknown;
    if (!link) return;
    event.preventDefault();

    if (typeof link === 'string') {
      this.router.navigateByUrl(link);
      return;
    }

    if (Array.isArray(link)) {
      this.router.navigate(link);
    }
  }

  async logout(): Promise<void> {
    try {
      await this.authService.logout();
    } finally {
      await this.router.navigateByUrl('/login');
    }
  }
}
