import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { from } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return from(authService.tryAutoLoginFromStorage()).pipe(
    switchMap(() =>
      authService.user$.pipe(
        take(1),
        map((user) => (user ? true : router.createUrlTree(['/login'])))
      )
    )
  );
};
