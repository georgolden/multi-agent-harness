import type { App } from '../../app.js';
import { RuntimeUser } from './user.js';

export class UserService {
  private readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  async start(): Promise<void> {
    console.log('[UserService] Ready');
  }

  async stop(): Promise<void> {}

  /**
   * Load a user with all their connected toolkits.
   * Returns a RuntimeUser that can build agent tools on demand.
   */
  async loadUser(userId: string): Promise<RuntimeUser> {
    const [user, toolkits] = await Promise.all([
      this.app.data.userRepository.getUser(userId),
      this.app.data.userToolkitRepository.getToolkits(userId),
    ]);

    if (!user) throw new Error(`[UserService] User not found: ${userId}`);

    return new RuntimeUser(user, toolkits, this.app);
  }
}
