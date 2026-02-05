import { Scheduler } from './scheduler.js';
import { TelegramService } from './telegram.js';
import config from '../config/services.js';
import { App } from '../app.js';

export class Services {
  scheduler: Scheduler;
  telegram: TelegramService;

  constructor(app: App) {
    this.scheduler = new Scheduler(app, config.Scheduler);
    this.telegram = new TelegramService(app, config.Telegram);
  }

  async start() {
    return Promise.all([this.scheduler.start(), this.telegram.start()]);
  }

  async stop() {
    return Promise.all([this.scheduler.stop(), this.telegram.stop()]);
  }
}
