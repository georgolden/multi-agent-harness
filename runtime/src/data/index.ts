import { MessageHistory, config as messageHistoryConfig } from './messageHistory/index.js';
import { TaskRepository } from './taskRepository/index.js';
import { UserRepository } from './userRepository/index.js';
import { FlowSessionRepository } from './flowSessionRepository/index.js';
import type { App } from '../app.js';

export class Data {
  messageHistory: MessageHistory;
  taskRepository: TaskRepository;
  userRepository: UserRepository;
  flowSessionRepository: FlowSessionRepository;

  constructor(app: App) {
    this.messageHistory = new MessageHistory(app, messageHistoryConfig);
    this.taskRepository = new TaskRepository(app);
    this.userRepository = new UserRepository(app);
    this.flowSessionRepository = new FlowSessionRepository(app);
  }

  async start() {
    await Promise.all([
      this.messageHistory.start(),
      this.taskRepository.start(),
      this.userRepository.start(),
      this.flowSessionRepository.start(),
    ]);
  }

  async stop() {
    await Promise.all([
      this.messageHistory.stop(),
      this.taskRepository.stop(),
      this.userRepository.stop(),
      this.flowSessionRepository.stop(),
    ]);
  }
}
