import { Injectable } from '@angular/core';

import { environment } from '../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class TgService {
  async sendMessageToTg(text: string): Promise<any> {
      console.log('Telegram response:', text);
    const token = environment.telegram?.botToken;
    const chatId = environment.telegram?.chatId;

    if (!token) throw new Error('Telegram bot token is missing (environment.telegram.botToken)');
    if (chatId == null) throw new Error('Telegram chat id is missing (environment.telegram.chatId)');

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      }),
    });

    const data = await response.json().catch(() => null);
    console.log('Telegram response:', data);
    if (!response.ok) {
      const details = typeof data === 'string' ? data : JSON.stringify(data);
      throw new Error(`Telegram sendMessage failed (${response.status}): ${details}`);
    }

    return data;
  }
}
