import { Routes } from '@angular/router';

import { LoginComponent } from './components/login/login.component';
import { RbOverviewComponent } from './components/rb-overview/rb-overview.component';
import { ConstPartyListComponent } from './components/const-party-list/const-party-list.component';
import { RbSessionListComponent } from './components/rb-session-list/rb-session-list.component';
import { StatisticsComponent } from './components/statistics/statistics.component';
import { authGuard } from './guards/auth.guard';
import { loginRedirectGuard } from './guards/login-redirect.guard';

export const routes: Routes = [
	{ path: '', component: RbOverviewComponent, canActivate: [authGuard] },
	{ path: 'users', component: ConstPartyListComponent, canActivate: [authGuard] },
	{ path: 'const-party', component: ConstPartyListComponent, canActivate: [authGuard] },
	{ path: 'raids', component: RbSessionListComponent, canActivate: [authGuard] },
	{ path: 'startistics', component: StatisticsComponent, canActivate: [authGuard] },
	{ path: 'login', component: LoginComponent, canActivate: [loginRedirectGuard] },
];

