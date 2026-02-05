import { MessageHistory } from './messageHistory.js';
import { Storage } from './storage.js';
import config from '../config/data.js';
import type { App } from '../app.js';

export class Data {
  messageHistory: MessageHistory;
  storage: Storage;

  constructor(app: App) {
    this.messageHistory = new MessageHistory(app, config.MessageHistory);
    this.storage = new Storage(app, config.Storage);
  }

  async start() {
    await Promise.all([this.messageHistory.start(), this.storage.start()]);
  }

  async stop() {
    await Promise.all([this.messageHistory.stop(), this.storage.stop()]);
  }
}
