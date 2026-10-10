import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs/operators';

import { SiteUsersService } from '../services/site-users.service';

/** «Бот» page: admins with the «Бот» switch on (/admin/users) */
export const botGuard: CanActivateFn = () => {
  const siteUsers = inject(SiteUsersService);
  const router = inject(Router);

  return siteUsers.canBot$.pipe(
    take(1),
    map((ok) => (ok ? true : router.createUrlTree(['/']))),
  );
};
