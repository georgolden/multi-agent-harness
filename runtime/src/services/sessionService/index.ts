import type { App } from '../../app.js';
import { Session } from './session.js';
import type { CreateSessionParams, SessionData, SessionHooks, SessionStatus } from './types.js';

export { Session } from './session.js';
export type { SessionHooks } from './types.js';

export class SessionService {
  private readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  // ─── Session lifecycle ────────────────────────────────────────────────────

  async create(params: CreateSessionParams, hooks: SessionHooks = {}): Promise<Session> {
    const data = await this.app.data.flowSessionRepository.createSession(params);
    const session = new Session(data, this.app, hooks);
    console.log(`[SessionService] Created session '${data.id}' for flow '${data.flowName}'`);
    return session;
  }

  async get(sessionId: string, hooks: SessionHooks = {}): Promise<Session | null> {
    const data = await this.app.data.flowSessionRepository.getSession(sessionId);
    if (!data) return null;
    return new Session(data, this.app, hooks);
  }

  // ─── Cross-session queries (return raw FlowSession data) ──────────────────

  async getUserSessions(userId: string, status?: SessionStatus): Promise<SessionData[]> {
    return this.app.data.flowSessionRepository.getUserSessions(userId, status);
  }

  async getRootSessions(userId: string): Promise<SessionData[]> {
    return this.app.data.flowSessionRepository.getRootSessions(userId);
  }
}
