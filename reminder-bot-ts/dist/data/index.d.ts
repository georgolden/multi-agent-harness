import { MessageHistory } from './messageHistory/index.js';
import { ReminderRepository } from './reminderRepository/index.js';
import type { App } from '../app.js';
export declare class Data {
    messageHistory: MessageHistory;
    reminderRepository: ReminderRepository;
    constructor(app: App);
    start(): Promise<void>;
    stop(): Promise<void>;
}
