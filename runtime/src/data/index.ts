import { TaskRepository } from './taskRepository/index.js';
import { UserRepository } from './userRepository/index.js';
import { SessionDataRepository } from './flowSessionRepository/index.js';
import { AgenticLoopSchemaRepository } from './agenticLoopSchemaRepository/index.js';
import type { App } from '../app.js';

export class Data {
  taskRepository: TaskRepository;
  userRepository: UserRepository;
  flowSessionRepository: SessionDataRepository;
  agenticLoopSchemaRepository: AgenticLoopSchemaRepository;

  constructor(app: App) {
    this.taskRepository = new TaskRepository(app);
    this.userRepository = new UserRepository(app);
    this.flowSessionRepository = new SessionDataRepository(app);
    this.agenticLoopSchemaRepository = new AgenticLoopSchemaRepository(app);
  }

  async start() {
    await Promise.all([
      this.taskRepository.start(),
      this.userRepository.start(),
      this.flowSessionRepository.start(),
      this.agenticLoopSchemaRepository.start(),
    ]);
  }

  async stop() {
    await Promise.all([
      this.taskRepository.stop(),
      this.userRepository.stop(),
      this.flowSessionRepository.stop(),
      this.agenticLoopSchemaRepository.stop(),
    ]);
  }
}
