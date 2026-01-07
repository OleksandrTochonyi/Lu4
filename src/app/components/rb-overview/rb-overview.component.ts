import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Timestamp } from 'firebase/firestore';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { PopoverModule } from 'primeng/popover';
import { MessageService } from 'primeng/api';

import { RbData } from '../../services/rb-data';
import { RbStatus } from '../../constants/status';
import { RbListComponent } from './components/rb-list/rb-list.component';
import { RbGridComponent } from './components/rb-grid/rb-grid.component';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-rb-overview',
  imports: [
    RbListComponent,
    RbGridComponent,
    FormsModule,
    ButtonModule,
    CheckboxModule,
    PopoverModule,
  ],
  templateUrl: './rb-overview.component.html',
  styleUrl: './rb-overview.component.scss'
})
export class RbOverviewComponent {
  private destroyRef = inject(DestroyRef);
  private rbDataService = inject(RbData);
  private messageService = inject(MessageService);

  showTableView = signal(false);

  items = signal<any[]>([]);

  showOnlyResp = signal(false);
  showOneHourToResp = signal(false);

  get showOnlyRespValue(): boolean {
    return this.showOnlyResp();
  }

  set showOnlyRespValue(value: boolean) {
    this.showOnlyResp.set(value);
  }

  get showOneHourToRespValue(): boolean {
    return this.showOneHourToResp();
  }

  set showOneHourToRespValue(value: boolean) {
    this.showOneHourToResp.set(value);
  }

  visibleItems = computed(() => {
    const items = this.items() ?? [];
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    const onlyResp = this.showOnlyResp();
    const oneHour = this.showOneHourToResp();

    return items.filter((item) => {
      if (!onlyResp && !oneHour) return true;

      const inResp = item?.status === RbStatus.InResp || item?.status === RbStatus.SecondResp;

      const minResp: Date | null = item?.minResp ?? null;
      const secondMinResp: Date | null = item?.secondMinResp ?? null;
      const minMs = minResp instanceof Date ? minResp.getTime() : null;
      const secondMinMs = secondMinResp instanceof Date ? secondMinResp.getTime() : null;
      const inOneHourToFirst = minMs != null && minMs > now && minMs - now <= hourMs;
      const inOneHourToSecond =
        secondMinMs != null && secondMinMs > now && secondMinMs - now <= hourMs;
      const inOneHourToResp = inOneHourToFirst || inOneHourToSecond;

      // If both toggles are enabled, treat them as OR.
      if (onlyResp && oneHour) return inResp || inOneHourToResp;
      if (onlyResp) return inResp;
      return inOneHourToResp;
    });
  });

  constructor() {
    this.rbDataService
      .getItems()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => {
        this.items.set((items ?? []).map((item) => this.enrichItem(item)));
      });

  }

  onDeadTimeDraftChanged(event: { rb: any; deadTime: Date | null }): void {
    const rbId = event.rb?.id;

    this.items.update((items) =>
      (items ?? []).map((item) => {
        if (rbId && item?.id !== rbId) return item;
        if (!rbId && item !== event.rb) return item;

        const lastDeadTime = event.deadTime ? Timestamp.fromDate(event.deadTime) : null;
        return this.enrichItem({ ...item, lastDeadTime });
      })
    );
  }

  onDeadTimeChanged(event: { rb: any; deadTime: Date | null }): void {
    const rbId = event.rb?.id;

    if (rbId) {
      this.rbDataService
        .setKillTime(rbId, event.deadTime)
        .then(() => {
          this.messageService.add({
            severity: 'success',
            summary: 'Как такой рак рб убивает??? Мамкин киллер..',
            detail: 'Ладно пох.. время сохранил',
            life: 3000,
          });
        })
        .catch((err) => console.error('Failed to set kill time:', err));
    }

    this.items.update((items) =>
      (items ?? []).map((item) => {
        if (rbId && item?.id !== rbId) return item;
        if (!rbId && item !== event.rb) return item;

        const lastDeadTime = event.deadTime ? Timestamp.fromDate(event.deadTime) : null;
        return this.enrichItem({ ...item, lastDeadTime });
      })
    );
  }

  private enrichItem(item: any): any {
    const deadTime = this.toDate(item?.lastDeadTime);
    const respTimeHours = item?.meta?.respTime;
    const plusMinusHours = item?.meta?.plusMinusRespTime;

    const minResp = this.addHours(deadTime, respTimeHours);
    const maxResp = this.addHours(minResp, plusMinusHours);

    const secondMinResp = this.addHours(minResp, respTimeHours);
    const secondMaxResp = this.addHours(maxResp, (Number(respTimeHours) || 0) + (Number(plusMinusHours) || 0));

    const status = this.calculateStatus(minResp, maxResp, secondMinResp, secondMaxResp);

    return {
      ...item,
      deadTime,
      minResp,
      maxResp,
      secondMinResp,
      secondMaxResp,
      status,
    };
  }

  private calculateStatus(
    minResp: Date | null,
    maxResp: Date | null,
    secondMinResp: Date | null,
    secondMaxResp: Date | null
  ): RbStatus {
    if (!minResp || !maxResp || !secondMinResp || !secondMaxResp) return RbStatus.Unknown;

    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    const min = minResp.getTime();
    const max = maxResp.getTime();
    const secondMin = secondMinResp.getTime();
    const secondMax = secondMaxResp.getTime();

    if (now < min) {
      if (min - now <= hourMs) return RbStatus.SoonResp;
      return RbStatus.NotInResp;
    }
    if (now >= min && now <= max) return RbStatus.InResp;
    if (now > max && now < secondMin) {
      if (secondMin - now <= hourMs) return RbStatus.SoonSecondResp;
      return RbStatus.FirstRespPassed;
    }
    if (now >= secondMin && now <= secondMax) return RbStatus.SecondResp;
    return RbStatus.Missed;
  }

  private toDate(value: any): Date | null {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private addHours(date: Date | null, hours: any): Date | null {
    if (!date) return null;
    const hoursNumber = Number(hours);
    if (!Number.isFinite(hoursNumber)) return date;
    return new Date(date.getTime() + hoursNumber * 60 * 60 * 1000);
  }

}
