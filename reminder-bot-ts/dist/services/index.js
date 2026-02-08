import { Scheduler, config as schedulerConfig } from './scheduler.js';
import { TelegramService, config as telegramConfig } from './telegram.js';
export class Services {
    scheduler;
    telegram;
    constructor(app) {
        this.scheduler = new Scheduler(app, schedulerConfig);
        this.telegram = new TelegramService(app, telegramConfig);
    }
    async start() {
        return Promise.all([this.scheduler.start(), this.telegram.start()]);
    }
    async stop() {
        return Promise.all([this.scheduler.stop(), this.telegram.stop()]);
    }
}
