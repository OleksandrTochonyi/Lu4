import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TableModule } from 'primeng/table';
import { OverlayPanelModule } from 'primeng/overlaypanel';
import { DropdownModule } from 'primeng/dropdown';
import { CalendarModule } from 'primeng/calendar';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';

import {
  RbSessionRecord,
  RbSessionService,
  RbSessionParticipant,
  RbSessionLootItem,
  CreateRbSessionPayload,
} from '../../services/rb-session.service';
import { RbData } from '../../services/rb-data';
import { ConstPartyService, ConstPartyGroup, ConstPartyUser } from '../../services/const-party.service';
import { RbSessionItemComponent } from './components/rb-session-item/rb-session-item.component';

interface RbOption {
  id: string;
  displayName?: string;
  lvl?: number;
  loot: any[];
}

@Component({
  selector: 'app-rb-session-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    OverlayPanelModule,
    DropdownModule,
    CalendarModule,
    CheckboxModule,
    InputTextModule,
    ButtonModule,
    ConfirmDialogModule,
    RbSessionItemComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './rb-session-list.component.html',
  styleUrl: './rb-session-list.component.scss',
})
export class RbSessionListComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly rbSessionService = inject(RbSessionService);
  private readonly rbDataService = inject(RbData);
  private readonly constPartyService = inject(ConstPartyService);
  private readonly confirmationService = inject(ConfirmationService);

  private readonly rows = signal<RbSessionRecord[]>([]);
  readonly sessions = computed(() => this.rows());
  readonly searchTerm = signal('');
  readonly filteredSessions = computed(() => this.filterSessions());

  readonly loading = signal(true);
  readonly creating = signal(false);
  readonly showForm = signal(false);
  readonly settingsVisible = signal(false);
  readonly editingSessionId = signal<string | null>(null);
  readonly isEditing = computed(() => this.editingSessionId() != null);

  private readonly savedSettings = signal<Map<string, Set<string>>>(new Map());
  private readonly settingsDraft = signal<Map<string, Set<string>>>(new Map());
  private readonly settingsStorageKey = 'rb-session-default-participants';

  readonly hasSavedSettings = computed(() => {
    for (const set of this.savedSettings().values()) {
      if (set.size) {
        return true;
      }
    }
    return false;
  });

  readonly rbOptions = signal<RbOption[]>([]);
  readonly groupOptions = signal<ConstPartyGroup[]>([]);

  private readonly selectedRbIdState = signal<string | null>(null);
  private readonly killDateState = signal<Date>(new Date());
  private readonly participantSelections = signal<Map<string, Set<string>>>(new Map());
  private readonly lootQuantities = signal<Record<string, number>>({});

  readonly selectedRb = computed(() => {
    const id = this.selectedRbIdState();
    if (!id) return null;
    return this.rbOptions().find((item) => item?.id === id) ?? null;
  });

  readonly availableLoot = computed(() => this.selectedRb()?.loot ?? []);

  constructor() {
    this.loadSavedSettingsFromStorage();

    this.rbSessionService
      .getSessions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          const sorted = (data ?? []).slice().sort((a, b) => {
            const aTime = a.killDate?.getTime() ?? 0;
            const bTime = b.killDate?.getTime() ?? 0;
            return bTime - aTime;
          });

          this.rows.set(sorted);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('Failed to load RB sessions:', err);
          this.rows.set([]);
          this.loading.set(false);
        },
      });

    this.rbDataService
      .getItems()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => {
        const normalized = (items ?? []).map((item: any) => ({
          id: item?.id ?? '',
          displayName: item?.displayName ?? item?.name ?? '',
          lvl: item?.lvl,
          loot: Array.isArray(item?.loot) ? item.loot : [],
        }));

        this.rbOptions.set(normalized.filter((item) => item.id));

        if (!this.selectedRbIdState() && this.rbOptions().length) {
          this.setSelectedRbId(this.rbOptions()[0]?.id ?? null);
        } else {
          this.syncLootQuantities();
        }
      });

    this.constPartyService
      .getGroups()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((groups) => {
        const normalized = (groups ?? []).map((group) => ({
          ...group,
          users: Array.isArray(group?.users) ? group.users : [],
        }));

        this.groupOptions.set(normalized);
        this.ensureParticipantSelections(normalized);
        this.syncSavedSettingsWithGroups(normalized);
      });
  }

  trackBySession(_index: number, item: RbSessionRecord): string {
    return item?.id ?? String(_index);
  }

  lootLabel(loot: RbSessionLootItem): string {
    const amount = loot?.amount ?? 0;
    const name = loot?.possibleLoot?.displayName ?? loot?.possibleLoot?.name ?? 'Лут';
    return `${amount || 0} × ${name}`;
  }

  trackByParticipant(index: number, participant: RbSessionParticipant): string {
    const group = participant?.groupId ?? participant?.group?.id ?? '';
    const usersKey = (participant?.users ?? []).join('|');
    return `${group}-${usersKey}-${index}`;
  }

  trackByGroup = (_index: number, group: ConstPartyGroup): string =>
    group?.id ?? String(_index);

  trackByUser = (_index: number, user: ConstPartyUser): string =>
    user?.name ?? String(_index);

  trackByAvailableLoot = (index: number, loot: any): string =>
    this.lootId(loot) || String(index);

  trackByLoot(index: number, loot: RbSessionLootItem): string {
    const id = loot?.possibleLoot?.id ?? loot?.possibleLoot?.name ?? '';
    return `${id}-${loot?.amount ?? 0}-${index}`;
  }

  participantGroupName(participant: RbSessionParticipant): string | null {
    const group = participant?.group;
    if (!group) return participant?.groupId ?? null;

    const name = group?.displayName ?? group?.name ?? group?.title ?? null;
    if (name) return name as string;

    return participant?.groupId ?? null;
  }

  participantUserCount(participant: RbSessionParticipant): number {
    return participant?.users?.length ?? 0;
  }

  get selectedRbIdValue(): string | null {
    return this.selectedRbIdState();
  }

  set selectedRbIdValue(value: string | null) {
    this.setSelectedRbId(value ?? null);
  }

  get killDateValue(): Date {
    return this.killDateState();
  }

  set killDateValue(value: Date) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      this.killDateState.set(value);
    }
  }

  isParticipantSelected(groupId: string, user: ConstPartyUser): boolean {
    const selections = this.participantSelections();
    const set = selections.get(groupId);
    return !!set && set.has(user?.name ?? '');
  }

  onParticipantToggle(groupId: string, user: ConstPartyUser, event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const checked = !!target?.checked;

    const baseMap = new Map(this.participantSelections());
    const userName = String(user?.name ?? '').trim();
    if (!userName) {
      this.participantSelections.set(baseMap);
      return;
    }

    const prevSet = baseMap.get(groupId) ?? new Set<string>();
    const nextSet = new Set(prevSet);

    if (checked) {
      nextSet.add(userName);
    } else {
      nextSet.delete(userName);
    }

    if (nextSet.size) {
      baseMap.set(groupId, nextSet);
    } else {
      baseMap.delete(groupId);
    }

    this.participantSelections.set(baseMap);
  }

  selectedCountForGroup(groupId: string): number {
    return this.participantSelections().get(groupId)?.size ?? 0;
  }

  lootAmount(lootId: string): number {
    return this.lootQuantities()[lootId] ?? 0;
  }

  onLootAmountChange(lootId: string, amount: number | null): void {
    if (!lootId) return;
    const sanitized = Number(amount ?? 0);
    const next = { ...this.lootQuantities() };
    next[lootId] = Number.isFinite(sanitized) && sanitized >= 0 ? sanitized : 0;
    this.lootQuantities.set(next);
  }

  onLootAmountInput(lootId: string, event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const value = target?.value ?? '';
    const parsed = Number(value);
    this.onLootAmountChange(lootId, Number.isFinite(parsed) ? parsed : 0);
  }

  async onCreateSession(): Promise<void> {
    if (this.creating()) return;

    const rbId = this.selectedRbIdState();
    if (!rbId) return;

    const payload: CreateRbSessionPayload = {
      rbId,
      killDate: this.killDateState(),
      participants: Array.from(this.participantSelections().entries()).map(([groupId, set]) => ({
        groupId,
        users: Array.from(set.values()),
      })),
      loot: Object.entries(this.lootQuantities())
        .map(([lootId, amount]) => ({ lootId, amount }))
        .filter((entry) => Number.isFinite(entry.amount) && entry.amount > 0),
    };

    if (!payload.participants.length && !payload.loot.length) {
      // No data to save
      return;
    }

    this.creating.set(true);

    try {
      await this.rbSessionService.createSession(payload);
      this.resetFormState();
      this.showForm.set(false);
    } catch (err) {
      console.error('Failed to create RB session:', err);
    } finally {
      this.creating.set(false);
    }
  }

  private setSelectedRbId(id: string | null): void {
    this.selectedRbIdState.set(id);
    this.syncLootQuantities();
  }

  private syncLootQuantities(): void {
    const rb = this.selectedRb();
    if (!rb) {
      this.lootQuantities.set({});
      return;
    }

    const current = this.lootQuantities();
    const next: Record<string, number> = {};

    for (const entry of rb.loot ?? []) {
      const lootId = this.resolveLootId(entry);
      if (!lootId) continue;
      next[lootId] = current[lootId] ?? 0;
    }

    this.lootQuantities.set(next);
  }

  private resolveLootId(entry: any): string | null {
    if (!entry) return null;
    if (typeof entry.id === 'string' && entry.id.trim()) return entry.id;
    if (typeof entry.name === 'string' && entry.name.trim()) return entry.name;
    return null;
  }

  lootId(entry: any): string {
    return this.resolveLootId(entry) ?? '';
  }

  lootDisplayName(entry: any): string {
    return entry?.displayName ?? entry?.name ?? 'Лут';
  }

  lootImage(entry: any): string | null {
    return typeof entry?.imgUrl === 'string' ? entry.imgUrl : null;
  }

  lootHasPayload(): boolean {
    return Object.values(this.lootQuantities()).some((amount) => Number(amount) > 0);
  }

  hasPayload(): boolean {
    return this.lootHasPayload() && this.participantsHaveSelection();
  }

  totalSelectedParticipants(): number {
    let total = 0;
    for (const set of this.participantSelections().values()) {
      total += set.size ?? 0;
    }
    return total;
  }

  private participantsHaveSelection(): boolean {
    for (const set of this.participantSelections().values()) {
      if (set.size > 0) return true;
    }
    return false;
  }

  private ensureParticipantSelections(groups: ConstPartyGroup[]): void {
    const current = new Map(this.participantSelections());
    for (const group of groups) {
      const groupId = String(group?.id ?? '').trim();
      if (!groupId) continue;
      if (!current.has(groupId)) {
        current.set(groupId, new Set());
      }
    }
    this.participantSelections.set(current);
  }

  private resetFormState(options?: { preserveRbSelection?: boolean }): void {
    const preserveRbSelection = options?.preserveRbSelection ?? false;

    this.killDateState.set(new Date());
    this.participantSelections.set(new Map());
    this.ensureParticipantSelections(this.groupOptions());
    this.applySavedDefaultsToParticipants();

    if (preserveRbSelection) {
      this.syncLootQuantities();
    } else {
      this.setSelectedRbId(null);
    }
  }

  onStartCreate(): void {
    this.editingSessionId.set(null);
    this.settingsVisible.set(false);
    this.resetFormState();
    this.showForm.set(true);
  }

  onCancelCreate(): void {
    this.resetFormState();
    this.editingSessionId.set(null);
    this.showForm.set(false);
  }

  onStartEdit(session: RbSessionRecord): void {
    if (!session?.id) {
      return;
    }

    this.editingSessionId.set(session.id);
    this.settingsVisible.set(false);
    this.populateFormFromSession(session);
    this.showForm.set(true);
  }

  onRequestDelete(session: RbSessionRecord): void {
    const id = session?.id;
    if (!id) {
      return;
    }

    this.confirmationService.confirm({
      header: 'Удалить событие?',
      message: 'Подтвердите удаление записи о событии рейд-босса.',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Удалить',
      rejectLabel: 'Отмена',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: async () => {
        try {
          if (this.editingSessionId() === id) {
            this.onCancelCreate();
          }
          await this.rbSessionService.deleteSession(id);
        } catch (err) {
          console.error('Failed to delete RB session:', err);
        }
      },
    });
  }

  onSearch(term: string): void {
    this.searchTerm.set((term ?? '').toLowerCase());
  }

  onSearchEvent(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.onSearch(target?.value ?? '');
  }

  onToggleSettings(): void {
    this.syncSavedSettingsWithGroups(this.groupOptions());
    const draft = this.cloneSelectionMap(this.savedSettings());
    this.settingsDraft.set(draft);

    this.settingsVisible.set(!this.settingsVisible());
  }

  settingsSelectedCount(groupId: string): number {
    return this.settingsDraft().get(String(groupId ?? '').trim())?.size ?? 0;
  }

  isSettingsUserSelected(groupId: string, user: ConstPartyUser): boolean {
    const groupKey = String(groupId ?? '').trim();
    const userName = String(user?.name ?? '').trim();
    if (!groupKey || !userName) {
      return false;
    }

    const set = this.settingsDraft().get(groupKey);
    return !!set && set.has(userName);
  }

  onSettingsUserToggle(groupId: string, user: ConstPartyUser, event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const checked = !!target?.checked;
    const groupKey = String(groupId ?? '').trim();
    const userName = String(user?.name ?? '').trim();
    if (!groupKey || !userName) {
      return;
    }

    const draft = this.cloneSelectionMap(this.settingsDraft());
    const set = draft.get(groupKey) ?? new Set<string>();

    if (checked) {
      set.add(userName);
    } else {
      set.delete(userName);
    }

    if (set.size) {
      draft.set(groupKey, set);
    } else {
      draft.delete(groupKey);
    }

    this.settingsDraft.set(draft);
  }

  onSaveSettings(): void {
    const groups = this.groupOptions();
    const filtered = this.filterSelectionMap(this.settingsDraft(), groups);
    this.savedSettings.set(filtered);
    this.settingsDraft.set(this.cloneSelectionMap(filtered));
    this.persistSavedSettings();
    this.settingsVisible.set(false);

    if (this.showForm() && !this.isEditing()) {
      this.participantSelections.set(new Map());
      this.ensureParticipantSelections(groups);
      this.applySavedDefaultsToParticipants();
    }
  }

  onCancelSettings(): void {
    this.settingsDraft.set(this.cloneSelectionMap(this.savedSettings()));
    this.settingsVisible.set(false);
  }

  onResetSettings(): void {
    this.savedSettings.set(new Map());
    this.settingsDraft.set(new Map());
    this.persistSavedSettings();

    if (this.showForm() && !this.isEditing()) {
      this.participantSelections.set(new Map());
      this.ensureParticipantSelections(this.groupOptions());
    }
  }

  async onSubmit(): Promise<void> {
    if (this.creating()) {
      return;
    }

    const payload = this.buildPayload();
    if (!payload) {
      return;
    }

    this.creating.set(true);

    try {
      if (this.isEditing()) {
        const sessionId = this.editingSessionId();
        if (sessionId) {
          await this.rbSessionService.updateSession(sessionId, payload);
        }
      } else {
        await this.rbSessionService.createSession(payload);
      }

      this.resetFormState();
      this.editingSessionId.set(null);
      this.showForm.set(false);
    } catch (err) {
      console.error(this.isEditing() ? 'Failed to update RB session:' : 'Failed to create RB session:', err);
    } finally {
      this.creating.set(false);
    }
  }

  private filterSessions(): RbSessionRecord[] {
    const term = this.searchTerm().trim();
    if (!term) {
      return this.sessions();
    }

    return this.sessions().filter((session) => this.matchesSession(session, term));
  }

  private buildPayload(): CreateRbSessionPayload | null {
    const rbId = this.selectedRbIdState();
    if (!rbId) {
      return null;
    }

    const participants = Array.from(this.participantSelections().entries()).map(([groupId, set]) => ({
      groupId,
      users: Array.from(set.values()),
    }));

    const loot = Object.entries(this.lootQuantities())
      .map(([lootId, amount]) => ({ lootId, amount }))
      .filter((entry) => Number.isFinite(entry.amount) && entry.amount > 0);

    return {
      rbId,
      killDate: this.killDateState(),
      participants,
      loot,
    } satisfies CreateRbSessionPayload;
  }

  private populateFormFromSession(session: RbSessionRecord): void {
    const rbId = session?.rb?.id ?? null;
    this.setSelectedRbId(typeof rbId === 'string' && rbId ? rbId : null);

    const killDate = session?.killDate instanceof Date ? session.killDate : new Date();
    this.killDateState.set(killDate);

    const selections = new Map<string, Set<string>>();
    for (const participant of session?.participants ?? []) {
      const groupId = String(participant?.groupId ?? participant?.group?.id ?? '').trim();
      if (!groupId) {
        continue;
      }

      const users = (participant?.users ?? []).filter(
        (user) => typeof user === 'string' && user.trim().length > 0
      );
      selections.set(groupId, new Set(users));
    }

    this.participantSelections.set(selections);
    this.ensureParticipantSelections(this.groupOptions());

    const baseQuantities = { ...this.lootQuantities() };
    Object.keys(baseQuantities).forEach((key) => {
      baseQuantities[key] = 0;
    });

    for (const loot of session?.loot ?? []) {
      const lootId = this.resolveLootId(loot?.possibleLoot);
      if (!lootId) {
        continue;
      }

      const amount = Number(loot?.amount ?? 0);
      if (!Number.isFinite(amount) || amount < 0) {
        continue;
      }

      baseQuantities[lootId] = amount;
    }

    this.lootQuantities.set(baseQuantities);
  }

  private matchesSession(session: RbSessionRecord, term: string): boolean {
    const lowerTerm = term.toLowerCase();

    const rbName = session?.rb?.displayName ?? session?.rb?.name ?? '';
    if (typeof rbName === 'string' && rbName.toLowerCase().includes(lowerTerm)) {
      return true;
    }

    for (const participant of session?.participants ?? []) {
      const groupName = this.participantGroupName(participant) ?? '';
      if (groupName.toLowerCase().includes(lowerTerm)) {
        return true;
      }

      for (const user of participant?.users ?? []) {
        if (typeof user === 'string' && user.toLowerCase().includes(lowerTerm)) {
          return true;
        }
      }
    }

    for (const loot of session?.loot ?? []) {
      const lootName = loot?.possibleLoot?.displayName ?? loot?.possibleLoot?.name ?? '';
      if (typeof lootName === 'string' && lootName.toLowerCase().includes(lowerTerm)) {
        return true;
      }
    }

    return false;
  }

  private applySavedDefaultsToParticipants(): void {
    const groups = this.groupOptions();
    if (!groups.length) {
      return;
    }

    const saved = this.filterSelectionMap(this.savedSettings(), groups);
    if (!saved.size) {
      return;
    }

    const base = new Map(this.participantSelections());
    saved.forEach((set, groupId) => {
      base.set(groupId, new Set(set));
    });

    this.participantSelections.set(base);
  }

  private syncSavedSettingsWithGroups(groups: ConstPartyGroup[]): void {
    const filteredSaved = this.filterSelectionMap(this.savedSettings(), groups);
    this.savedSettings.set(filteredSaved);

    const filteredDraft = this.filterSelectionMap(this.settingsDraft(), groups);
    if (filteredDraft.size) {
      this.settingsDraft.set(filteredDraft);
    } else {
      this.settingsDraft.set(this.cloneSelectionMap(filteredSaved));
    }

    this.persistSavedSettings();
  }

  private cloneSelectionMap(source: Map<string, Set<string>>): Map<string, Set<string>> {
    const clone = new Map<string, Set<string>>();
    source.forEach((set, groupId) => {
      clone.set(groupId, new Set(set));
    });
    return clone;
  }

  private filterSelectionMap(
    source: Map<string, Set<string>>,
    groups: ConstPartyGroup[]
  ): Map<string, Set<string>> {
    const filtered = new Map<string, Set<string>>();
    if (!source?.size || !groups?.length) {
      return filtered;
    }

    const groupMap = new Map<string, ConstPartyGroup>();
    for (const group of groups) {
      const groupId = String(group?.id ?? '').trim();
      if (groupId) {
        groupMap.set(groupId, group);
      }
    }

    source.forEach((originalSet, originalGroupId) => {
      const groupId = String(originalGroupId ?? '').trim();
      if (!groupId) {
        return;
      }

      const group = groupMap.get(groupId);
      if (!group) {
        return;
      }

      const allowedUsers = new Set<string>();
      for (const user of group.users ?? []) {
        const userName = String(user?.name ?? '').trim();
        if (userName) {
          allowedUsers.add(userName);
        }
      }

      if (!allowedUsers.size) {
        return;
      }

      const validUsers = new Set<string>();
      originalSet?.forEach((name) => {
        const trimmed = String(name ?? '').trim();
        if (trimmed && allowedUsers.has(trimmed)) {
          validUsers.add(trimmed);
        }
      });

      if (validUsers.size) {
        filtered.set(groupId, validUsers);
      }
    });

    return filtered;
  }

  private loadSavedSettingsFromStorage(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const raw = window.localStorage.getItem(this.settingsStorageKey);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Record<string, string[]>;
      const map = new Map<string, Set<string>>();

      if (parsed && typeof parsed === 'object') {
        Object.entries(parsed).forEach(([groupId, users]) => {
          const trimmedGroupId = String(groupId ?? '').trim();
          if (!trimmedGroupId) {
            return;
          }

          const set = new Set<string>();
          if (Array.isArray(users)) {
            users.forEach((name) => {
              const trimmedName = String(name ?? '').trim();
              if (trimmedName) {
                set.add(trimmedName);
              }
            });
          }

          if (set.size) {
            map.set(trimmedGroupId, set);
          }
        });
      }

      this.savedSettings.set(map);
      this.settingsDraft.set(this.cloneSelectionMap(map));
    } catch (err) {
      console.error('Failed to load RB session defaults from storage:', err);
    }
  }

  private persistSavedSettings(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const payload: Record<string, string[]> = {};
    for (const [groupId, set] of this.savedSettings().entries()) {
      if (set.size) {
        payload[groupId] = Array.from(set.values());
      }
    }

    if (Object.keys(payload).length) {
      window.localStorage.setItem(this.settingsStorageKey, JSON.stringify(payload));
    } else {
      window.localStorage.removeItem(this.settingsStorageKey);
    }
  }
}
