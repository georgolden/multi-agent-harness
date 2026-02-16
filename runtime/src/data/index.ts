import { MessageHistory, config as messageHistoryConfig } from './messageHistory/index.js';
import { ReminderRepository } from './reminderRepository/index.js';
import { UserRepository } from './userRepository/index.js';
import { FlowSessionRepository } from './flowSessionRepository/index.js';
import type { App } from '../app.js';

export class Data {
  messageHistory: MessageHistory;
  reminderRepository: ReminderRepository;
  userRepository: UserRepository;
  flowSessionRepository: FlowSessionRepository;

  constructor(app: App) {
    this.messageHistory = new MessageHistory(app, messageHistoryConfig);
    this.reminderRepository = new ReminderRepository(app);
    this.userRepository = new UserRepository(app);
    this.flowSessionRepository = new FlowSessionRepository(app);
  }

  async start() {
    await Promise.all([
      this.messageHistory.start(),
      this.reminderRepository.start(),
      this.userRepository.start(),
      this.flowSessionRepository.start(),
    ]);
  }

  async stop() {
    await Promise.all([
      this.messageHistory.stop(),
      this.reminderRepository.stop(),
      this.userRepository.stop(),
      this.flowSessionRepository.stop(),
    ]);
  }
}
