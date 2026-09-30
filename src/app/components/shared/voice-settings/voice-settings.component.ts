import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CheckboxModule } from 'primeng/checkbox';
import { PopoverModule } from 'primeng/popover';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { RespVoiceService } from '../../../services/resp-voice.service';

/**
 * Header button + popover with every voice setting: which voice, what gets
 * voiced (resp announcements / actions), and a single «Прослушать».
 */
@Component({
  selector: 'app-voice-settings',
  standalone: true,
  imports: [FormsModule, CheckboxModule, PopoverModule, ToggleSwitchModule],
  templateUrl: './voice-settings.component.html',
  styleUrl: './voice-settings.component.scss',
})
export class VoiceSettingsComponent {
  readonly voice = inject(RespVoiceService);

  readonly anyOn = computed(() => this.voice.enabled() || this.voice.actionsEnabled());
  readonly currentLabel = computed(
    () => this.voice.voiceSets().find((v) => v.key === this.voice.voiceSet())?.label ?? '',
  );
}
