import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CalendarModule } from 'primeng/calendar';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ProgressBarModule } from 'primeng/progressbar';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import {
  RbSessionService,
  RbSessionRecord,
  RbSessionParticipant,
} from '../../services/rb-session.service';
import { ConstPartyService, ConstPartyGroup } from '../../services/const-party.service';

interface GroupAttendanceStat {
  id: string;
  name: string;
  attended: number;
  percentage: number;
  totalSessions: number;
  memberCount: number;
  uniqueParticipants: number;
  participantShare: number;
  totalAttendanceCount: number;
  averageParticipants: number;
}

interface UserAttendanceStat {
  id: string;
  name: string;
  groupName: string | null;
  groupId: string | null;
  attended: number;
  percentage: number;
  totalSessions: number;
}

interface GroupDictionary {
  byId: Map<string, ConstPartyGroup>;
  byName: Map<string, string>;
}

interface SessionGroupPayload {
  id?: string | null;
  displayName?: string | null;
  name?: string | null;
  title?: string | null;
  label?: string | null;
  users?: Array<{ name?: string | null }> | null;
}

interface UserGroupFilterOption {
  key: string;
  label: string;
  count: number;
}

type GroupMetricMode = 'events' | 'participants';

@Component({
  selector: 'app-statistics',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CalendarModule,
    CardModule,
    TableModule,
    ProgressBarModule,
    ButtonModule,
    TagModule,
  ],
  templateUrl: './statistics.component.html',
  styleUrl: './statistics.component.scss',
})
export class StatisticsComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly rbSessionService = inject(RbSessionService);
  private readonly constPartyService = inject(ConstPartyService);

  private readonly sessionsState = signal<RbSessionRecord[]>([]);
  private readonly groupsState = signal<ConstPartyGroup[]>([]);

  private readonly sessionsLoaded = signal(false);
  private readonly groupsLoaded = signal(false);

  readonly loading = computed(() => !this.sessionsLoaded() || !this.groupsLoaded());
  readonly maxDate = new Date();

  private readonly startDateState = signal<Date | null>(null);
  private readonly endDateState = signal<Date | null>(null);
  private readonly selectedUserGroupKey = signal<string>('__all__');
  private readonly groupMetricModeState = signal<GroupMetricMode>('events');

  private readonly dateFormatter = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
  });

  constructor() {
    this.rbSessionService
      .getSessions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (sessions) => {
          const sorted = (sessions ?? [])
            .slice()
            .sort((a, b) => {
              const aTime = a.killDate?.getTime() ?? 0;
              const bTime = b.killDate?.getTime() ?? 0;
              return bTime - aTime;
            });

          this.sessionsState.set(sorted);
          this.sessionsLoaded.set(true);
        },
        error: (err) => {
          console.error('Не удалось загрузить сессии для статистики', err);
          this.sessionsState.set([]);
          this.sessionsLoaded.set(true);
        },
      });

    this.constPartyService
      .getGroups()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (groups) => {
          const normalized = (groups ?? [])
            .map((group) => ({
              ...group,
              displayName: this.cleanString(group.displayName) ?? group.id,
              users: Array.isArray(group.users) ? group.users : [],
            }))
            .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''));

          this.groupsState.set(normalized);
          this.groupsLoaded.set(true);
        },
        error: (err) => {
          console.error('Не удалось загрузить состав групп для статистики', err);
          this.groupsState.set([]);
          this.groupsLoaded.set(true);
        },
      });
  }

  get startDateModel(): Date | null {
    return this.startDateState();
  }

  set startDateModel(value: Date | null) {
    const normalized = this.normalizeDate(value);
    this.startDateState.set(normalized);

    const start = this.startDateState();
    const end = this.endDateState();
    if (start && end && start.getTime() > end.getTime()) {
      this.endDateState.set(new Date(start));
    }
  }

  get endDateModel(): Date | null {
    return this.endDateState();
  }

  set endDateModel(value: Date | null) {
    const normalized = this.normalizeDate(value);
    const start = this.startDateState();
    if (normalized && start && normalized.getTime() < start.getTime()) {
      this.startDateState.set(new Date(normalized));
    }

    this.endDateState.set(normalized);
  }

  readonly periodDescription = computed(() => {
    const from = this.startDateState();
    const to = this.endDateState();

    if (!from && !to) {
      return 'Все доступные сессии';
    }

    if (from && to) {
      return `${this.dateFormatter.format(from)} — ${this.dateFormatter.format(to)}`;
    }

    if (from) {
      return `С ${this.dateFormatter.format(from)}`;
    }

    return `До ${this.dateFormatter.format(to!)}`;
  });

  readonly filteredSessions = computed(() => {
    const sessions = this.sessionsState();
    if (!sessions.length) return [];

    const from = this.startDateState();
    const to = this.endDateState();

    const fromTime = from?.getTime() ?? null;
    const toTime = to ? this.endOfDay(to).getTime() : null;

    return sessions.filter((session) => {
      const date = session.killDate;
      if (!date) {
        return fromTime == null && toTime == null;
      }

      const time = date.getTime();
      if (fromTime != null && time < fromTime) {
        return false;
      }
      if (toTime != null && time > toTime) {
        return false;
      }
      return true;
    });
  });

  readonly totalSessions = computed(() => this.filteredSessions().length);

  readonly groupStatistics = computed<GroupAttendanceStat[]>(() => {
    const sessions = this.filteredSessions();
    const totalSessions = sessions.length;
    const groups = this.groupsState();
    const dictionaries = this.buildGroupDictionary(groups);

    const stats = new Map<string, GroupAttendanceStat>();
    const attendeeSets = new Map<string, Set<string>>();

    groups.forEach((group) => {
      if (!group?.id) return;
      const memberCount = Array.isArray(group.users) ? group.users.length : 0;
      stats.set(group.id, {
        id: group.id,
        name: group.displayName ?? group.id,
        attended: 0,
        percentage: 0,
        totalSessions,
        memberCount,
        uniqueParticipants: 0,
        participantShare: 0,
        totalAttendanceCount: 0,
        averageParticipants: 0,
      });
      attendeeSets.set(group.id, new Set<string>());
    });

    sessions.forEach((session) => {
      const seenGroups = new Set<string>();
      (session.participants ?? []).forEach((participant) => {
        const info = this.resolveGroupKey(participant, dictionaries);
        if (!info) return;

        let stat = stats.get(info.key);
        if (!stat) {
          stat = {
            id: info.key,
            name: info.name,
            attended: 0,
            percentage: 0,
            totalSessions,
            memberCount: info.memberCount,
            uniqueParticipants: 0,
            participantShare: 0,
            totalAttendanceCount: 0,
            averageParticipants: 0,
          } satisfies GroupAttendanceStat;
          stats.set(info.key, stat);
        }

        stat.name = stat.name || info.name;
        stat.memberCount = Math.max(stat.memberCount, info.memberCount);

        const attendeeCount = Array.isArray(participant.users) ? participant.users.length : 0;
        stat.totalAttendanceCount += attendeeCount;

        let attendeeSet = attendeeSets.get(info.key);
        if (!attendeeSet) {
          attendeeSet = new Set<string>();
          attendeeSets.set(info.key, attendeeSet);
        }

        const targetSet = attendeeSet;
        (participant.users ?? []).forEach((userName) => {
          const normalized = this.normalizeKey(userName);
          if (!normalized) return;
          targetSet.add(normalized);
        });

        seenGroups.add(info.key);
      });

      seenGroups.forEach((key) => {
        const entry = stats.get(key);
        if (!entry) return;
        entry.attended += 1;
      });
    });

    return Array.from(stats.values())
      .map((entry) => {
        const uniqueCount = attendeeSets.get(entry.id)?.size ?? entry.uniqueParticipants ?? 0;
        const memberCount = Math.max(entry.memberCount ?? 0, uniqueCount);
        const percentage = totalSessions ? (entry.attended / totalSessions) * 100 : 0;
        const averageParticipants = totalSessions
          ? entry.totalAttendanceCount / totalSessions
          : 0;
        const participantShare = memberCount ? (averageParticipants / memberCount) * 100 : 0;

        return {
          ...entry,
          totalSessions,
          percentage,
          uniqueParticipants: uniqueCount,
          memberCount,
          participantShare,
          totalAttendanceCount: entry.totalAttendanceCount,
          averageParticipants,
        } satisfies GroupAttendanceStat;
      })
      .sort((a, b) => {
        if (b.percentage !== a.percentage) return b.percentage - a.percentage;
        if (b.attended !== a.attended) return b.attended - a.attended;
        return a.name.localeCompare(b.name);
      });
  });

  readonly userStatistics = computed<UserAttendanceStat[]>(() => {
    const sessions = this.filteredSessions();
    const totalSessions = sessions.length;
    const groups = this.groupsState();
    const dictionaries = this.buildGroupDictionary(groups);

    const userDirectory = new Map<
      string,
      {
        name: string;
        groupName: string | null;
        groupId: string | null;
      }
    >();

    groups.forEach((group) => {
      const groupName = group.displayName ?? group.id;
      (group.users ?? []).forEach((user) => {
        const key = this.normalizeKey(user?.name);
        if (!key) return;
        if (!userDirectory.has(key)) {
          userDirectory.set(key, {
            name: this.cleanString(user?.name) ?? user.name,
            groupName,
            groupId: group.id,
          });
        }
      });
    });

    const stats = new Map<string, UserAttendanceStat>();

    userDirectory.forEach((value, key) => {
      stats.set(key, {
        id: key,
        name: value.name,
        groupName: value.groupName,
        groupId: value.groupId,
        attended: 0,
        percentage: 0,
        totalSessions,
      });
    });

    sessions.forEach((session) => {
      const seenUsers = new Set<string>();
      (session.participants ?? []).forEach((participant) => {
        const groupInfo = this.resolveGroupKey(participant, dictionaries);
        const fallbackGroupName = groupInfo?.name ?? null;
        const fallbackGroupKey = groupInfo?.key ?? null;

        (participant.users ?? []).forEach((userName) => {
          const key = this.normalizeKey(userName);
          if (!key) return;
          if (seenUsers.has(key)) return;
          seenUsers.add(key);

          const directoryEntry = userDirectory.get(key);
          const displayName = directoryEntry?.name ?? this.cleanString(userName) ?? 'Неизвестный игрок';
          const resolvedGroupName = directoryEntry?.groupName ?? fallbackGroupName;
          const resolvedGroupId =
            directoryEntry?.groupId ??
            (fallbackGroupKey && fallbackGroupKey !== '__ungrouped__' ? fallbackGroupKey : null);

          const current = stats.get(key);
          if (current) {
            stats.set(key, {
              ...current,
              attended: current.attended + 1,
              groupName: current.groupName ?? resolvedGroupName ?? null,
              groupId: current.groupId ?? resolvedGroupId ?? null,
              percentage: 0,
              totalSessions,
            });
          } else {
            stats.set(key, {
              id: key,
              name: displayName,
              groupName: resolvedGroupName ?? null,
              groupId: resolvedGroupId ?? null,
              attended: 1,
              percentage: 0,
              totalSessions,
            });
          }
        });
      });
    });

    return Array.from(stats.values())
      .map((entry) => ({
        ...entry,
        totalSessions,
        percentage: totalSessions ? (entry.attended / totalSessions) * 100 : 0,
      }))
      .sort((a, b) => {
        if (b.attended !== a.attended) return b.attended - a.attended;
        if (b.percentage !== a.percentage) return b.percentage - a.percentage;
        return a.name.localeCompare(b.name);
      });
  });

  readonly activeGroupCount = computed(
    () => this.groupStatistics().filter((group) => group.attended > 0).length
  );

  readonly activeUserCount = computed(
    () => this.userStatistics().filter((user) => user.attended > 0).length
  );

  readonly topGroup = computed(() => {
    const list = this.groupStatistics().filter((group) => group.attended > 0);
    return list.length ? list[0] : null;
  });

  readonly topParticipantGroup = computed(() => {
    const list = this.groupStatistics().filter((group) => group.participantShare > 0);
    if (!list.length) {
      return null;
    }
    return list.reduce((best, current) =>
      current.participantShare > best.participantShare ? current : best
    );
  });

  readonly topUser = computed(() => {
    const list = this.userStatistics().filter((user) => user.attended > 0);
    return list.length ? list[0] : null;
  });

  readonly groupMetricMode = computed(() => this.groupMetricModeState());

  readonly userGroupFilters = computed<UserGroupFilterOption[]>(() => {
    const stats = this.userStatistics();
    const options = new Map<string, { label: string; count: number }>();

    stats.forEach((stat) => {
      const key = stat.groupId ?? '__none__';
      const label = stat.groupName ?? 'Без группы';
      const current = options.get(key);
      if (current) {
        current.count += 1;
      } else {
        options.set(key, { label, count: 1 });
      }
    });

    const result: UserGroupFilterOption[] = [
      {
        key: '__all__',
        label: 'Все группы',
        count: stats.length,
      },
    ];

    const sorted = Array.from(options.entries()).sort((a, b) =>
      a[1].label.localeCompare(b[1].label)
    );

    sorted.forEach(([key, value]) => {
      result.push({
        key,
        label: value.label,
        count: value.count,
      });
    });

    return result;
  });

  readonly activeUserGroupKey = computed(() => this.selectedUserGroupKey());

  readonly filteredUserStatistics = computed<UserAttendanceStat[]>(() => {
    const key = this.selectedUserGroupKey();
    const stats = this.userStatistics();

    if (key === '__all__') {
      return stats;
    }

    if (key === '__none__') {
      return stats.filter((stat) => !stat.groupId);
    }

    return stats.filter((stat) => stat.groupId === key);
  });

  resetRange(): void {
    this.startDateState.set(null);
    this.endDateState.set(null);
  }

  selectUserGroupFilter(key: string): void {
    if (this.selectedUserGroupKey() === key) {
      return;
    }
    this.selectedUserGroupKey.set(key);
  }

  setGroupMetricMode(mode: GroupMetricMode): void {
    if (this.groupMetricModeState() === mode) {
      return;
    }
    this.groupMetricModeState.set(mode);
  }

  trackByGroupStat = (_index: number, item: GroupAttendanceStat): string => item.id;
  trackByUserStat = (_index: number, item: UserAttendanceStat): string => item.id;

  private normalizeDate(value: Date | null): Date | null {
    if (!value) return null;
    const normalized = new Date(value);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  }

  private endOfDay(value: Date): Date {
    const result = new Date(value);
    result.setHours(23, 59, 59, 999);
    return result;
  }

  private cleanString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
  }

  private normalizeKey(value: unknown): string | null {
    const cleaned = this.cleanString(value);
    return cleaned ? cleaned.toLowerCase() : null;
  }

  private extractGroupName(participant: RbSessionParticipant | null | undefined): string | null {
    if (!participant) return null;

    const group = participant.group as SessionGroupPayload | null | undefined;
    const candidates = [
      group?.displayName,
      group?.name,
      group?.title,
      group?.label,
    ];

    for (const candidate of candidates) {
      const cleaned = this.cleanString(candidate);
      if (cleaned) return cleaned;
    }

    return null;
  }

  private buildGroupDictionary(groups: ConstPartyGroup[]): GroupDictionary {
    const byId = new Map<string, ConstPartyGroup>();
    const byName = new Map<string, string>();

    groups.forEach((group) => {
      if (!group?.id) return;
      byId.set(group.id, group);

      const normalizedName = this.normalizeKey(group.displayName);
      if (normalizedName && !byName.has(normalizedName)) {
        byName.set(normalizedName, group.id);
      }
    });

    return { byId, byName };
  }

  private resolveGroupKey(
    participant: RbSessionParticipant | null | undefined,
    dictionaries: GroupDictionary
  ): { key: string; name: string; memberCount: number } | null {
    if (!participant) return null;

    const groupPayload = participant.group as SessionGroupPayload | null | undefined;
    const explicitId =
      this.cleanString(participant.groupId) ?? this.cleanString(groupPayload?.id);
    const groupData = explicitId ? dictionaries.byId.get(explicitId) : null;
    const participantName = this.extractGroupName(participant);

    let key = explicitId ?? null;
    if (!key && participantName) {
      const normalized = this.normalizeKey(participantName);
      if (normalized) {
        key = dictionaries.byName.get(normalized) ?? `name|${normalized}`;
      }
    }
    if (!key) {
      key = '__ungrouped__';
    }

    let name = groupData?.displayName ?? participantName ?? null;
    if (!name) {
      if (key === '__ungrouped__') {
        name = 'Без группы';
      } else if (explicitId) {
        name = `Группа ${explicitId}`;
      } else {
        name = 'Без группы';
      }
    }

    const memberCount =
      groupData?.users?.length ?? (groupPayload?.users?.length ?? participant.users?.length ?? 0);

    return {
      key,
      name,
      memberCount,
    };
  }
}
