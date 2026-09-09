import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs/operators';

import { SiteUsersService } from '../services/site-users.service';

export const adminGuard: CanActivateFn = () => {
  const siteUsers = inject(SiteUsersService);
  const router = inject(Router);

  return siteUsers.isAdmin$.pipe(
    take(1),
    map((isAdmin) => (isAdmin ? true : router.createUrlTree(['/'])))
  );
};
