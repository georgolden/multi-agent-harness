import { TaskRepository } from './taskRepository/index.js';
import { UserRepository } from './userRepository/index.js';
import { SessionDataRepository } from './flowSessionRepository/index.js';
import type { App } from '../app.js';

export class Data {
  taskRepository: TaskRepository;
  userRepository: UserRepository;
  flowSessionRepository: SessionDataRepository;

  constructor(app: App) {
    this.taskRepository = new TaskRepository(app);
    this.userRepository = new UserRepository(app);
    this.flowSessionRepository = new SessionDataRepository(app);
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
