import { Scheduler } from './scheduler/index.js';
import { TelegramService } from './telegram/index.js';
import { App } from '../app.js';
export declare class Services {
    scheduler: Scheduler;
    telegram: TelegramService;
    constructor(app: App);
    start(): Promise<[void, void]>;
    stop(): Promise<[void, void]>;
}
