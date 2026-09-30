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
import { SiteUsersService } from './services/site-users.service';
import { ActivityLogService } from './services/activity-log.service';
import { ThemeService } from './services/theme.service';
import { RespVoiceService } from './services/resp-voice.service';
import { VoiceSettingsComponent } from './components/shared/voice-settings/voice-settings.component';

const PAGE_NAMES: Record<string, string> = {
  '/': 'Букмарки',
  '/bookmarks': 'Букмарки',
  '/bookmarks-new': 'Букмарки',
  '/bookmarks-ng': 'Букмарки NoGrade',
  '/home-new': 'Главная',
  '/users': 'Клан',
  '/const-party': 'Клан',
  '/warehouse': 'Склад',
  '/raids': 'Рейды',
  '/rb-map': 'Карта РБ',
  '/rb-map-new': 'Карта РБ',
  '/rb-list': 'Список РБ',
  '/rb-list-new': 'Список РБ',
  '/startistics': 'Статистика',
  '/admin/users': 'Пользователи',
};

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
    VoiceSettingsComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private router = inject(Router);
  private authService = inject(AuthService);
  private siteUsers = inject(SiteUsersService);
  private activityLog = inject(ActivityLogService);
  readonly theme = inject(ThemeService);
  private voice = inject(RespVoiceService);
  private location = inject(Location);
  private destroyRef = inject(DestroyRef);

  private lastLoggedPath = '';
  private lastLoggedAt = 0;

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
  })[] = [
    {
      label: 'Bookmarks',
      icon: 'pi pi-bookmark',
      routerLink: '/',
    },
    {
      label: 'Bookmarks',
      badge: 'NG',
      icon: 'pi pi-bookmark',
      routerLink: '/bookmarks-ng',
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
    // Statistics (/startistics) — hidden for everyone for now; route + component
    // still exist, just not surfaced in the menu.
    // {
    //   label: 'Statistics',
    //   icon: 'pi pi-chart-bar',
    //   routerLink: '/startistics',
    //   adminOnly: true,
    // },
    {
      label: 'Users',
      icon: 'pi pi-user-edit',
      routerLink: '/admin/users',
      adminOnly: true,
    },
  ];

  ngOnInit() {
    // before the first NavigationEnd, so /login never flashes inverted
    this.theme.setAllowed(!this.isLoginPage);

    void this.authService.tryAutoLoginFromStorage().then((ok) => {
      if (!ok) this.kickToLogin();
    });

    // signed out from anywhere (another tab, token revoked, …) → leave the page
    this.authService.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        // stored creds present + no user = auto-login still in flight; the promise
        // above handles the failure case
        if (!user && this.authService.getStoredCredentials() == null) this.kickToLogin();
      });

    // the 1-week limit can run out while the tab sits open — check periodically
    // and whenever the tab comes back into view
    const checkExpiry = () => {
      if (this.authService.isSessionExpired()) this.kickToLogin('expired');
    };
    const timer = setInterval(checkExpiry, 60 * 1000);
    document.addEventListener('visibilitychange', checkExpiry);
    this.destroyRef.onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', checkExpiry);
    });

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e) => {
        this.currentUrl = e.urlAfterRedirects;
        this.theme.setAllowed(!this.isLoginPage);
        checkExpiry();
        const path = e.urlAfterRedirects.split('?')[0].split('#')[0];
        if (path === '/login') return;
        const now = Date.now();
        // don't spam the log if the same page is re-hit within a few seconds
        if (path === this.lastLoggedPath && now - this.lastLoggedAt < 8000) return;
        this.lastLoggedPath = path;
        this.lastLoggedAt = now;
        this.activityLog.log('Открыл', PAGE_NAMES[path] ?? path, 'nav');
      });

    combineLatest([this.siteUsers.isAdmin$, this.siteUsers.newIpAlerts$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([isAdmin, alerts]) => {
        this.items = this.allMenuItems
          .filter((item) => isAdmin || !item.adminOnly)
          .map((item) =>
            // unseen "new IP" alerts show as a badge on Users
            item.routerLink === '/admin/users' && alerts.length
              ? { ...item, badge: String(alerts.length), badgeStyleClass: 'ip-alert-badge' }
              : item,
          );
      });

    // an account that's already inside the app and loses access (blocked, or
    // removed from the list) gets bounced out live
    this.siteUsers.deniedReason$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((reason) => {
        if (!reason || this.isLoginPage) return;
        const param = reason === 'blocked' ? 'blocked' : 'denied';
        void this.authService
          .logout()
          .finally(() => this.router.navigate(['/login'], { queryParams: { [param]: 1 } }));
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

  private kicking = false;

  /** full sign-out + redirect to /login (no-op when already there) */
  private kickToLogin(reason?: 'expired'): void {
    if (this.isLoginPage || this.kicking) return;
    this.kicking = true;
    void this.authService
      .logout()
      .catch(() => null)
      .finally(() => {
        this.kicking = false;
        void this.router.navigate(['/login'], reason ? { queryParams: { [reason]: 1 } } : {});
      });
  }

  async logout(): Promise<void> {
    // the user$ watcher would otherwise race us with a second sign-out + redirect
    this.kicking = true;
    this.voice.action('logout');
    try {
      await this.authService.logout();
    } finally {
      await this.router.navigateByUrl('/login');
      this.kicking = false;
    }
  }
}
