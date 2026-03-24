import { TaskRepository } from './taskRepository/index.js';
import { UserRepository } from './userRepository/index.js';
import { SessionDataRepository } from './flowSessionRepository/index.js';
import { AgenticLoopSchemaRepository } from './agenticLoopSchemaRepository/index.js';
import { AgentSessionRepository } from './agentSessionRepository/index.js';
import type { App } from '../app.js';

export class Data {
  taskRepository: TaskRepository;
  userRepository: UserRepository;
  flowSessionRepository: SessionDataRepository;
  agenticLoopSchemaRepository: AgenticLoopSchemaRepository;
  agentSessionRepository: AgentSessionRepository;

  constructor(app: App) {
    this.taskRepository = new TaskRepository(app);
    this.userRepository = new UserRepository(app);
    this.flowSessionRepository = new SessionDataRepository(app);
    this.agenticLoopSchemaRepository = new AgenticLoopSchemaRepository(app);
    this.agentSessionRepository = new AgentSessionRepository(app);
  }

  async start() {
    await Promise.all([
      this.taskRepository.start(),
      this.userRepository.start(),
      this.flowSessionRepository.start(),
      this.agenticLoopSchemaRepository.start(),
      this.agentSessionRepository.start(),
    ]);
  }

  async stop() {
    await Promise.all([
      this.taskRepository.stop(),
      this.userRepository.stop(),
      this.flowSessionRepository.stop(),
      this.agenticLoopSchemaRepository.stop(),
      this.agentSessionRepository.stop(),
    ]);
  }
}
