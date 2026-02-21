import type { App } from '../../app.js';
import type {
  FlowSession,
  FlowMessage,
  FlowSessionStatus,
  ContextFile,
  ContextFolderInfo,
  ToolSchema,
  SkillSchema,
  ToolLog,
  SkillLog,
  FlowSessionTreeNode,
} from '../../data/flowSessionRepository/types.js';
import { AgentTool } from '../../types.js';
import type { SessionHooks } from './types.js';

/**
 * Session — a live, self-updating object backed by the FlowSessionRepository.
 *
 * All mutating methods update the repository immediately and keep the in-memory
 * data in sync.  Every mutating method returns `Promise<this>` to allow chaining.
 * Lifecycle hooks fire after each repository update.
 *
 * Tree-query methods return raw FlowSession data (not Session objects) because
 * related sessions are read-only in that context.
 *
 * Usage:
 *   const session = await sessionService.create({ ... });
 *   await session.addMessages([{ message: userMsg }]);
 *   await session.respond('What is your name?');
 *   // … later, when done …
 *   await session.respond(filledTemplate).then(s => s.complete());
 */
export class Session {
  sessionData: FlowSession;
  app: App;
  hooks: SessionHooks;
  tools: AgentTool[] = [];

  constructor(sessionData: FlowSession, app: App, hooks: SessionHooks = {}) {
    this.sessionData = sessionData;
    this.app = app;
    this.hooks = hooks;
  }

  // ─── Read-only accessors ──────────────────────────────────────────────────

  get id(): string {
    return this.sessionData.id;
  }
  get userId(): string {
    return this.sessionData.userId;
  }
  get flowName(): string {
    return this.sessionData.flowName;
  }
  get systemPrompt(): string {
    return this.sessionData.systemPrompt;
  }
  get userPromptTemplate(): string | undefined {
    return this.sessionData.userPromptTemplate;
  }
  get status(): FlowSessionStatus {
    return this.sessionData.status;
  }
  get parentSessionId(): string | undefined {
    return this.sessionData.parentSessionId;
  }
  get messages(): FlowMessage[] {
    return this.sessionData.messages;
  }
  get activeMessages(): FlowMessage[] {
    return this.sessionData.activeMessages;
  }
  get messageWindowConfig(): FlowSession['messageWindowConfig'] {
    return this.sessionData.messageWindowConfig;
  }
  get contextFiles(): ContextFile[] {
    return this.sessionData.contextFiles;
  }
  get contextFoldersInfos(): FlowSession['contextFoldersInfos'] {
    return this.sessionData.contextFoldersInfos;
  }
  get toolSchemas(): ToolSchema[] {
    return this.sessionData.toolSchemas;
  }
  get skillSchemas(): SkillSchema[] {
    return this.sessionData.skillSchemas;
  }
  get callLlmOptions(): FlowSession['callLlmOptions'] {
    return this.sessionData.callLlmOptions;
  }
  get agentLoopConfig(): FlowSession['agentLoopConfig'] {
    return this.sessionData.agentLoopConfig;
  }
  get toolLogs(): ToolLog[] {
    return this.sessionData.toolLogs;
  }
  get skillLogs(): SkillLog[] {
    return this.sessionData.skillLogs;
  }
  get startedAt(): Date {
    return this.sessionData.startedAt;
  }
  get endedAt(): Date | undefined {
    return this.sessionData.endedAt;
  }

  /** The most recent message in the active window, or undefined. */
  lastMessage(): FlowMessage | undefined {
    return this.sessionData.activeMessages[this.sessionData.activeMessages.length - 1];
  }

  addAgentTools(tools: AgentTool[]) {
    this.tools = [...this.tools, ...tools];
  }

  getAgentTool(name: string): AgentTool | undefined {
    return this.tools.find((t) => t.name === name);
  }

  // ─── Message mutations ────────────────────────────────────────────────────

  /** Add messages; refreshes the active window and fires onMessage hook. */
  async addMessages(messages: Omit<FlowMessage, 'timestamp'>[]): Promise<this> {
    const activeMessages = await this.app.data.flowSessionRepository.addMessages(this.sessionData.id, messages);
    this.sessionData.activeMessages = activeMessages;
    await this.hooks.onMessage?.(this);
    return this;
  }

  // ─── Context / schema mutations ───────────────────────────────────────────

  async addContextFiles(files: ContextFile[]): Promise<this> {
    const contextFiles = await this.app.data.flowSessionRepository.addContextFiles(this.sessionData.id, files);
    this.sessionData.contextFiles = contextFiles;
    return this;
  }

  async addContextFoldersInfos(folders: ContextFolderInfo[]): Promise<this> {
    const contextFoldersInfos = await this.app.data.flowSessionRepository.addContextFoldersInfos(this.sessionData.id, folders);
    this.sessionData.contextFoldersInfos = contextFoldersInfos;
    return this;
  }

  async addTools(tools: ToolSchema[]): Promise<this> {
    const toolSchemas = await this.app.data.flowSessionRepository.addTools(this.sessionData.id, tools);
    this.sessionData.toolSchemas = toolSchemas;
    return this;
  }

  async addSkills(skills: SkillSchema[]): Promise<this> {
    const skillSchemas = await this.app.data.flowSessionRepository.addSkills(this.sessionData.id, skills);
    this.sessionData.skillSchemas = skillSchemas;
    return this;
  }

  // ─── Execution log mutations ──────────────────────────────────────────────

  async logToolExecution(log: ToolLog): Promise<this> {
    await this.app.data.flowSessionRepository.logToolExecution(this.sessionData.id, log);
    this.sessionData.toolLogs = [...this.sessionData.toolLogs, log];
    return this;
  }

  async logSkillExecution(log: SkillLog): Promise<this> {
    await this.app.data.flowSessionRepository.logSkillExecution(this.sessionData.id, log);
    this.sessionData.skillLogs = [...this.sessionData.skillLogs, log];
    return this;
  }

  // ─── Status transitions ───────────────────────────────────────────────────

  async running(): Promise<this> {
    return this._updateStatus('running');
  }
  async complete(): Promise<this> {
    return this._updateStatus('completed');
  }
  async fail(): Promise<this> {
    return this._updateStatus('failed');
  }
  async pause(): Promise<this> {
    return this._updateStatus('paused');
  }

  // ─── Communication ────────────────────────────────────────────────────────

  /**
   * Send a message to the user.
   * Emits `session:respond` on the bus with the whole session data and the
   * message so consumers have full context (flowName, userId, status, etc.).
   * Does NOT change status — call complete() / fail() separately if needed.
   */
  async respond(message: string): Promise<this> {
    this.app.infra.bus.emit('session:respond', { session: this.sessionData, message });
    return this;
  }

  // ─── Tree queries (return raw FlowSession data) ───────────────────────────

  async parent(): Promise<FlowSession | null> {
    return this.app.data.flowSessionRepository.getParent(this.sessionData.id);
  }

  async children(): Promise<FlowSession[]> {
    return this.app.data.flowSessionRepository.getChildren(this.sessionData.id);
  }

  async childrenTreeNodes(): Promise<FlowSessionTreeNode[]> {
    return this.app.data.flowSessionRepository.getChildrenTreeNodes(this.sessionData.id);
  }

  /** Full ancestor chain from root to this session. */
  async path(): Promise<FlowSession[]> {
    return this.app.data.flowSessionRepository.getSessionPath(this.sessionData.id);
  }

  /** All descendants (this session + children recursively). */
  async subtree(): Promise<FlowSession[]> {
    return this.app.data.flowSessionRepository.getSubtree(this.sessionData.id);
  }

  async treeStats(): Promise<{ depth: number; descendantCount: number; childCount: number }> {
    return this.app.data.flowSessionRepository.getTreeStats(this.sessionData.id);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Delete this session from the repository.
   * Pass deleteDescendants=true to also remove child sessions.
   * After calling delete(), do not call any other methods on this instance.
   */
  async delete(deleteDescendants: boolean = false): Promise<boolean> {
    return this.app.data.flowSessionRepository.deleteSession(this.sessionData.id, deleteDescendants);
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async _updateStatus(to: FlowSessionStatus): Promise<this> {
    const from = this.sessionData.status;
    await this.app.data.flowSessionRepository.updateStatus(this.sessionData.id, to);
    this.sessionData.status = to;
    if (to === 'completed' || to === 'failed') {
      this.sessionData.endedAt = new Date();
    }

    await this.hooks.onStatusChange?.(this, from, to);

    switch (to) {
      case 'running':
        await this.hooks.onRunning?.(this);
        break;
      case 'completed':
        await this.hooks.onCompleted?.(this);
        break;
      case 'failed':
        await this.hooks.onFailed?.(this);
        break;
      case 'paused':
        await this.hooks.onPaused?.(this);
        break;
    }

    return this;
  }
}
