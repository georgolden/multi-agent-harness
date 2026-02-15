import { Scheduler, config as schedulerConfig } from './scheduler/index.js';
import { TelegramService, config as telegramConfig } from './telegram/index.js';
import { SandboxService } from './sandbox/index.js';
import { App } from '../app.js';

export class Services {
  scheduler: Scheduler;
  telegram: TelegramService;
  sandbox: SandboxService;

  constructor(app: App) {
    this.scheduler = new Scheduler(app, schedulerConfig);
    this.telegram = new TelegramService(app, telegramConfig);
    this.sandbox = new SandboxService(app);
  }

  async start() {
    return Promise.all([this.scheduler.start(), this.telegram.start(), this.sandbox.start()]);
  }

  async stop() {
    return Promise.all([this.scheduler.stop(), this.telegram.stop(), this.sandbox.stop()]);
  }
}
