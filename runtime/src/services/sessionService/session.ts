import type { App } from '../../app.js';

import type { FileInfo } from '../../utils/file.js';
import type { FolderInfo } from '../../utils/folder.js';
import { AgentTool } from '../../types.js';
import type {
  SessionData,
  SessionDataTreeNode,
  SessionHooks,
  SessionMessage,
  SessionStatus,
  SkillLog,
  SkillSchema,
  ToolLog,
  ToolSchema,
} from './types.js';
import { User } from '../../data/userRepository/types.js';
import { UserMessage } from '../../utils/message.js';

/**
 * Session — a live, self-updating object backed by the SessionDataRepository.
 *
 * All mutating methods update the repository immediately and keep the in-memory
 * data in sync.  Every mutating method returns `Promise<this>` to allow chaining.
 * Lifecycle hooks fire after each repository update.
 *
 * Tree-query methods return raw SessionData data (not Session objects) because
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
  sessionData: SessionData;
  app: App;
  hooks: SessionHooks;
  tools: AgentTool[] = [];

  private _userMessageCallbacks: Array<(payload: { session: SessionData; message: string; user: User }) => void> = [];

  constructor(sessionData: SessionData, app: App, hooks: SessionHooks = {}) {
    this.sessionData = sessionData;
    this.app = app;
    this.hooks = hooks;
    this._attachUserMessageListener();
  }

  private _attachUserMessageListener(): void {
    const eventName = `user:message:${this.userId}:${this.id}`;
    this.app.infra.bus.on(eventName, (payload: { session: SessionData; message: string; user: User }) => {
      const callbacks = this._userMessageCallbacks.splice(0);
      for (const cb of callbacks) cb(payload);
    });
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
  get status(): SessionStatus {
    return this.sessionData.status;
  }
  get parentSessionId(): string | undefined {
    return this.sessionData.parentSessionId;
  }
  get messages(): SessionMessage[] {
    return this.sessionData.messages;
  }
  get activeMessages(): SessionMessage[] {
    return this.sessionData.activeMessages;
  }
  get messageWindowConfig(): SessionData['messageWindowConfig'] {
    return this.sessionData.messageWindowConfig;
  }
  get contextFiles(): FileInfo[] {
    return this.sessionData.contextFiles;
  }
  get contextFoldersInfos(): SessionData['contextFoldersInfos'] {
    return this.sessionData.contextFoldersInfos;
  }
  get toolSchemas(): ToolSchema[] {
    return this.sessionData.toolSchemas;
  }
  get skillSchemas(): SkillSchema[] {
    return this.sessionData.skillSchemas;
  }
  get tempFiles(): SessionData['tempFiles'] {
    return this.sessionData.tempFiles;
  }
  get callLlmOptions(): SessionData['callLlmOptions'] {
    return this.sessionData.callLlmOptions;
  }
  get agentLoopConfig(): SessionData['agentLoopConfig'] {
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
  lastMessage(): SessionMessage | undefined {
    return this.sessionData.activeMessages[this.sessionData.activeMessages.length - 1];
  }

  addAgentTools(tools: AgentTool[]) {
    this.tools = [...this.tools, ...tools];
  }

  getAgentTool(name: string): AgentTool | undefined {
    return this.tools.find((t) => t.name === name);
  }

  // ─── Node transaction ─────────────────────────────────────────────────────

  async beginNodeTransaction(): Promise<void> {
    await this.app.data.flowSessionRepository.beginNodeTransaction(this.sessionData.id);
  }

  async commitNodeTransaction(nodeName: string, packetData: unknown): Promise<void> {
    await this.app.data.flowSessionRepository.commitNodeTransaction(this.sessionData.id, nodeName, packetData);
    this.sessionData.currentNodeName = nodeName;
    this.sessionData.currentPacketData = packetData;
  }

  async rollbackNodeTransaction(): Promise<void> {
    await this.app.data.flowSessionRepository.rollbackNodeTransaction(this.sessionData.id);
  }

  async setFlowSchema(schema: unknown): Promise<this> {
    await this.app.data.flowSessionRepository.setFlowSchema(this.sessionData.id, schema);
    this.sessionData.flowSchema = schema;
    return this;
  }

  // ─── Message mutations ────────────────────────────────────────────────────

  /** Add messages; refreshes the active window and fires onMessage hook. */
  async addMessages(messages: Omit<SessionMessage, 'timestamp'>[]): Promise<this> {
    const activeMessages = await this.app.data.flowSessionRepository.addMessages(this.sessionData.id, messages);
    this.sessionData.activeMessages = activeMessages;
    await this.hooks.onMessage?.(this);
    return this;
  }

  /**
   * Add a user message, prepending any existing temp files as formatted XML before the content.
   * Temp files are only attached when tempFiles is non-empty.
   */
  async addUserMessage(message: UserMessage): Promise<this> {
    const content = message.toJSON().content as string;
    const tempFiles = this.sessionData.tempFiles;
    let fullContent = content;

    if (tempFiles && tempFiles.length > 0) {
      const filesXml = tempFiles
        .map((f) => `  <file>\n    <name>${f.name}</name>\n    <content>${f.content}</content>\n  </file>`)
        .join('\n');
      fullContent = `<temp_files>\n${filesXml}\n</temp_files>\n<user_message>${content}</user_message>`;
    }

    return this.addMessages([{ message: new UserMessage(fullContent).toJSON() }]);
  }

  // ─── Context / schema mutations ───────────────────────────────────────────

  async addContextFiles(files: FileInfo[]): Promise<this> {
    const contextFiles = await this.app.data.flowSessionRepository.addContextFiles(this.sessionData.id, files);
    this.sessionData.contextFiles = contextFiles;
    return this;
  }

  async addContextFoldersInfos(folders: FolderInfo[]): Promise<this> {
    const contextFoldersInfos = await this.app.data.flowSessionRepository.addContextFoldersInfos(
      this.sessionData.id,
      folders,
    );
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

  async writeTempFile(file: { name: string; content: string }): Promise<this> {
    const tempFiles = await this.app.data.flowSessionRepository.writeTempFile(this.sessionData.id, file);
    this.sessionData.tempFiles = tempFiles;
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
  async resume(): Promise<this> {
    return this._updateStatus('running');
  }

  // ─── Communication ────────────────────────────────────────────────────────

  /**
   * Send a message to the user.
   * Emits `session:respond` on the bus with the whole session data and the
   * message so consumers have full context (flowName, userId, status, etc.).
   * Does NOT change status — call complete() / fail() separately if needed.
   */
  async respond(user: User, message: string): Promise<this> {
    this.app.infra.bus.emit('session:message', { session: this.sessionData, message, user: user });
    return this;
  }

  onUserMessage(cb: (payload: { session: SessionData; message: string; user: User }) => void) {
    this._userMessageCallbacks.push(cb);
    return this;
  }

  // ─── Tree queries (return raw SessionData data) ───────────────────────────

  async parent(): Promise<SessionData | null> {
    return this.app.data.flowSessionRepository.getParent(this.sessionData.id);
  }

  async children(): Promise<SessionData[]> {
    return this.app.data.flowSessionRepository.getChildren(this.sessionData.id);
  }

  async childrenTreeNodes(): Promise<SessionDataTreeNode[]> {
    return this.app.data.flowSessionRepository.getChildrenTreeNodes(this.sessionData.id);
  }

  /** Full ancestor chain from root to this session. */
  async path(): Promise<SessionData[]> {
    return this.app.data.flowSessionRepository.getSessionPath(this.sessionData.id);
  }

  /** All descendants (this session + children recursively). */
  async subtree(): Promise<SessionData[]> {
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

  private async _updateStatus(to: SessionStatus): Promise<this> {
    const from = this.sessionData.status;
    await this.app.data.flowSessionRepository.updateStatus(this.sessionData.id, to);
    this.sessionData.status = to;
    if (to === 'completed' || to === 'failed') {
      this.sessionData.endedAt = new Date();
    }

    await this.hooks.onStatusChange?.(this, from, to);

    switch (to) {
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
