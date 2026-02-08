import { MessageHistory, config as messageHistoryConfig } from './messageHistory/index.js';
import { ReminderRepository, config as storageConfig } from './reminderRepository/index.js';
export class Data {
    messageHistory;
    reminderRepository;
    constructor(app) {
        this.messageHistory = new MessageHistory(app, messageHistoryConfig);
        this.reminderRepository = new ReminderRepository(app, storageConfig);
    }
    async start() {
        await Promise.all([this.messageHistory.start(), this.reminderRepository.start()]);
    }
    async stop() {
        await Promise.all([this.messageHistory.stop(), this.reminderRepository.stop()]);
    }
}
