import { TaskRepository } from './taskRepository/index.js';
import { UserRepository } from './userRepository/index.js';
import { FlowSessionRepository } from './flowSessionRepository/index.js';
import type { App } from '../app.js';

export class Data {
  taskRepository: TaskRepository;
  userRepository: UserRepository;
  flowSessionRepository: FlowSessionRepository;

  constructor(app: App) {
    this.taskRepository = new TaskRepository(app);
    this.userRepository = new UserRepository(app);
    this.flowSessionRepository = new FlowSessionRepository(app);
  }

  async start() {
    await Promise.all([
      this.taskRepository.start(),
      this.userRepository.start(),
      this.flowSessionRepository.start(),
    ]);
  }

  async stop() {
    await Promise.all([
      this.taskRepository.stop(),
      this.userRepository.stop(),
      this.flowSessionRepository.stop(),
    ]);
  }
}
