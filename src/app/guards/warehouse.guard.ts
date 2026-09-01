import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { combineLatest, from } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { AuthService } from '../services/auth.service';
import { isWarehouseEmail } from '../data/warehouse-access';

/** Warehouse ("WH") is open to admins and to the whitelisted e-mails only. */
export const warehouseGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return from(auth.tryAutoLoginFromStorage()).pipe(
    switchMap(() =>
      combineLatest([auth.isAdmin$, auth.user$]).pipe(
        take(1),
        map(([isAdmin, user]) =>
          isAdmin || isWarehouseEmail(user?.email) ? true : router.createUrlTree(['/']),
        ),
      ),
    ),
  );
};
