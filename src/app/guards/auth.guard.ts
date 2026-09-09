import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { AuthService } from '../services/auth.service';
import { SiteUsersService } from '../services/site-users.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const siteUsers = inject(SiteUsersService);
  const router = inject(Router);

  return from(authService.tryAutoLoginFromStorage()).pipe(
    switchMap(() => authService.user$.pipe(take(1))),
    switchMap((user) => {
      if (!user) return of(router.createUrlTree(['/login']));
      // strict allowlist: must have a site-users row that isn't blocked
      return siteUsers.deniedReason$.pipe(
        take(1),
        map((reason) => {
          if (!reason) return true;
          void authService.logout();
          const param = reason === 'blocked' ? 'blocked' : 'denied';
          return router.createUrlTree(['/login'], { queryParams: { [param]: 1 } });
        }),
      );
    }),
  );
};
