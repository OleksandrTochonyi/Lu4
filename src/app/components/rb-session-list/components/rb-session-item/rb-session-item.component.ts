import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { OverlayPanelModule } from 'primeng/overlaypanel';

import type {
  RbSessionRecord,
  RbSessionParticipant,
  RbSessionLootItem,
} from '../../../../services/rb-session.service';

@Component({
  selector: 'app-rb-session-item',
  standalone: true,
  imports: [CommonModule, OverlayPanelModule],
  templateUrl: './rb-session-item.component.html',
  styleUrl: './rb-session-item.component.scss',
})
export class RbSessionItemComponent {
  session = input.required<RbSessionRecord>();

  lootLabel(loot: RbSessionLootItem): string {
    const amount = loot?.amount ?? 0;
    const name = loot?.possibleLoot?.displayName ?? loot?.possibleLoot?.name ?? 'Лут';
    return `${amount || 0} × ${name}`;
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
}
