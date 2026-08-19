import { Routes } from '@angular/router';

import { LoginComponent } from './components/login/login.component';
import { RbOverviewComponent } from './components/rb-overview/rb-overview.component';
import { ConstPartyListComponent } from './components/const-party-list/const-party-list.component';
import { RbSessionListComponent } from './components/rb-session-list/rb-session-list.component';
import { StatisticsComponent } from './components/statistics/statistics.component';
import { RaidBossListComponent } from './components/raid-boss-list/raid-boss-list.component';
import { RbMapComponent } from './components/rb-map/rb-map.component';
import { BookmarksComponent } from './components/bookmarks/bookmarks.component';
import { HomeNewComponent } from './components/home-new/home-new.component';
import { BookmarksNewComponent } from './components/bookmarks-new/bookmarks-new.component';
import { RbListNewComponent } from './components/rb-list-new/rb-list-new.component';
import { RbMapNewComponent } from './components/rb-map-new/rb-map-new.component';
import { authGuard } from './guards/auth.guard';
import { adminGuard } from './guards/admin.guard';
import { loginRedirectGuard } from './guards/login-redirect.guard';

export const routes: Routes = [
	{ path: '', component: RbOverviewComponent, canActivate: [authGuard] },
	{ path: 'users', component: ConstPartyListComponent, canActivate: [authGuard, adminGuard] },
	{ path: 'const-party', component: ConstPartyListComponent, canActivate: [authGuard, adminGuard] },
	{ path: 'raids', component: RbSessionListComponent, canActivate: [authGuard, adminGuard] },
	{ path: 'rb-list', component: RaidBossListComponent, canActivate: [authGuard, adminGuard] },
	{ path: 'rb-map', component: RbMapComponent, canActivate: [authGuard] },
	{ path: 'bookmarks', component: BookmarksComponent, canActivate: [authGuard] },
	{ path: 'startistics', component: StatisticsComponent, canActivate: [authGuard, adminGuard] },
	{ path: 'home-new', component: HomeNewComponent, canActivate: [authGuard] },
	{ path: 'bookmarks-new', component: BookmarksNewComponent, canActivate: [authGuard] },
	{ path: 'rb-list-new', component: RbListNewComponent, canActivate: [authGuard, adminGuard] },
	{ path: 'rb-map-new', component: RbMapNewComponent, canActivate: [authGuard] },
	{ path: 'login', component: LoginComponent, canActivate: [loginRedirectGuard] },
];

