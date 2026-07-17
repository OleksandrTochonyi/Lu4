import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, computed, input, signal } from '@angular/core';
import { OverlayPanelModule } from 'primeng/overlaypanel';

import type {
  RbSessionRecord,
  RbSessionParticipant,
  RbSessionLootItem,
} from '../../../../services/rb-session.service';

const MAX_VISIBLE_PARTICIPANTS = 6;
const MAX_VISIBLE_LOOT = 5;

@Component({
  selector: 'app-rb-session-item',
  standalone: true,
  imports: [CommonModule, OverlayPanelModule],
  templateUrl: './rb-session-item.component.html',
  styleUrl: './rb-session-item.component.scss',
})
export class RbSessionItemComponent {
  session = input.required<RbSessionRecord>();

  @Output() edit = new EventEmitter<RbSessionRecord>();
  @Output() remove = new EventEmitter<RbSessionRecord>();

  readonly expanded = signal(false);
  readonly participantsOpen = signal(true);
  readonly lootOpen = signal(true);

  readonly participants = computed(() => this.session().participants ?? []);
  readonly loot = computed(() => this.session().loot ?? []);

  readonly visibleParticipants = computed(() =>
    this.participants().slice(0, MAX_VISIBLE_PARTICIPANTS)
  );
  readonly hiddenParticipantCount = computed(() =>
    Math.max(0, this.participants().length - MAX_VISIBLE_PARTICIPANTS)
  );

  readonly visibleLoot = computed(() => this.loot().slice(0, MAX_VISIBLE_LOOT));
  readonly hiddenLootCount = computed(() =>
    Math.max(0, this.loot().length - MAX_VISIBLE_LOOT)
  );

  toggleExpanded(): void {
    this.expanded.update((value) => !value);
  }

  toggleParticipants(): void {
    this.participantsOpen.update((value) => !value);
  }

  toggleLoot(): void {
    this.lootOpen.update((value) => !value);
  }

  onEdit(event: Event): void {
    event.stopPropagation();
    this.edit.emit(this.session());
  }

  onRemove(event: Event): void {
    event.stopPropagation();
    this.remove.emit(this.session());
  }

  rbName(): string {
    const rb = this.session().rb;
    return rb?.displayName ?? rb?.name ?? '—';
  }

  rbLevel(): number | null {
    const rb = this.session().rb;
    const level = rb?.lvl ?? rb?.level;
    return Number.isFinite(level) ? level : null;
  }

  rbImage(): string | null {
    const rb = this.session().rb;
    const image = rb?.meta?.imageUrl ?? rb?.imageUrl ?? null;
    return typeof image === 'string' && image.trim() ? image : null;
  }

  rbBadge(): string {
    const rb = this.session().rb;
    const type = rb?.npcType ?? rb?.type ?? '';
    if (typeof type === 'string' && type.trim()) {
      return type;
    }
    return 'Raid Boss';
  }

  lootImage(loot: RbSessionLootItem): string | null {
    const item = loot?.possibleLoot;
    if (!item) return null;

    if (typeof item.imgUrl === 'string' && item.imgUrl.trim()) {
      return item.imgUrl;
    }
    if (typeof item.iconFile === 'string' && item.iconFile.trim()) {
      return `https://explorer.l2api.dev/icons/${item.iconFile}`;
    }
    return null;
  }

  lootAmount(loot: RbSessionLootItem): number {
    return loot?.amount ?? 0;
  }

  lootName(loot: RbSessionLootItem): string {
    return loot?.possibleLoot?.displayName ?? loot?.possibleLoot?.name ?? 'Лут';
  }

  lootLabel(loot: RbSessionLootItem): string {
    return `${this.lootAmount(loot) || 0} × ${this.lootName(loot)}`;
  }

  participantGroupName(participant: RbSessionParticipant): string {
    const group = participant?.group;
    const name =
      group?.displayName ?? group?.name ?? group?.title ?? participant?.groupId ?? null;
    return (name as string) ?? 'Группа';
  }

  participantUserCount(participant: RbSessionParticipant): number {
    return participant?.users?.length ?? 0;
  }
}
