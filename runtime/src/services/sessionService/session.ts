import type { App } from '../../app.js';

import type { FileInfo } from '../../utils/file.js';
import type { FolderInfo } from '../../utils/folder.js';
import { AgentTool } from '../../types.js';
import type {
  EnabledSkill,
  EnabledSkillRecord,
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
import type { Skills } from '../../skills/index.js';
import type { SandboxService } from '../sandbox/index.js';
import type { RuntimeUser } from '../userService/index.js';
import { AssistantTextMessage, ToolResultMessage, UserMessage } from '../../utils/message.js';

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

  private _enabledSkills: Map<string, EnabledSkill> = new Map();
  private _userMessageCallbacks: Array<(payload: { session: SessionData; message: string; user: RuntimeUser }) => void> = [];
  /** Pending parent context XML — prepended to the first user message then cleared. */
  private _parentContextXml: string | null = null;

  constructor(sessionData: SessionData, app: App, hooks: SessionHooks = {}) {
    this.sessionData = sessionData;
    this.app = app;
    this.hooks = hooks;
    this._attachUserMessageListener();
  }

  private _attachUserMessageListener(): void {
    const eventName = `user:message:${this.userId}:${this.id}`;
    this.app.infra.bus.on(eventName, (payload: { session: SessionData; message: string; user: RuntimeUser }) => {
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

  addOrReplaceAgentTools(tools: AgentTool[]): void {
    for (const tool of tools) {
      const idx = this.tools.findIndex((t) => t.name === tool.name);
      if (idx >= 0) this.tools[idx] = tool;
      else this.tools.push(tool);
    }
  }

  getAgentTool(name: string): AgentTool | undefined {
    return this.tools.find((t) => t.name === name);
  }

  // ─── Enabled skills ───────────────────────────────────────────────────────

  get enabledSkillRecords(): EnabledSkillRecord[] {
    return this.sessionData.enabledSkills;
  }

  get enabledSkills(): EnabledSkill[] {
    return Array.from(this._enabledSkills.values());
  }

  getEnabledSkill(name: string): EnabledSkill | undefined {
    return this._enabledSkills.get(name);
  }

  async enableSkill(name: string, entry: EnabledSkill): Promise<this> {
    await this.app.data.flowSessionRepository.enableSkill(this.sessionData.id, name);
    this.sessionData.enabledSkills = [...this.sessionData.enabledSkills.filter((s) => s.name !== name), { name }];
    this._enabledSkills.set(name, entry);
    return this;
  }

  updateEnabledSkillSandbox(name: string, sandboxSession: import('../sandbox/index.js').SkillExecutionSession): void {
    const entry = this._enabledSkills.get(name);
    if (entry) entry.sandboxSession = sandboxSession;
  }

  async disableSkill(name: string, sandbox?: SandboxService): Promise<this> {
    const entry = this._enabledSkills.get(name);
    if (!entry) return this;

    if (entry.sandboxSession && sandbox) {
      await sandbox.cleanupSkillSession({ session: this });
    }
    this._enabledSkills.delete(name);
    await this.app.data.flowSessionRepository.disableSkill(this.sessionData.id, name);
    this.sessionData.enabledSkills = this.sessionData.enabledSkills.filter((s) => s.name !== name);

    const stripped = this.sessionData.systemPrompt.replace(
      new RegExp(`\\n*<skill name="${name}">[\\s\\S]*?</skill>`, 'g'),
      '',
    );
    if (stripped !== this.sessionData.systemPrompt) {
      await this.upsertSystemPrompt(stripped);
    }
    return this;
  }

  async rehydrateEnabledSkills(skills: Skills, sandbox?: SandboxService): Promise<this> {
    for (const record of this.sessionData.enabledSkills) {
      const skill = skills.getSkill(record.name);
      if (!skill) continue;

      let sandboxSession = null;
      if (skill.runtime && sandbox) {
        try {
          sandboxSession = await sandbox.createSkillSession({ session: this, skill });
          const sandboxedTools = sandbox.createSandboxedTools(sandboxSession);
          this.addOrReplaceAgentTools([sandboxedTools.bash, sandboxedTools.read, sandboxedTools.edit, sandboxedTools.write]);
        } catch {
          // sandbox unavailable — continue without it
        }
      }
      this._enabledSkills.set(record.name, { skill, sandboxSession });
    }
    return this;
  }

  async cleanupSkillSessions(sandbox: SandboxService): Promise<void> {
    for (const entry of this._enabledSkills.values()) {
      if (entry.sandboxSession) {
        await sandbox.cleanupSkillSession({ session: this }).catch(() => {});
      }
    }
    this._enabledSkills.clear();
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

  /**
   * Replace (or insert) the system prompt as the first message.
   * Also updates `session.systemPrompt` so callers see the new value immediately.
   */
  async upsertSystemPrompt(content: string): Promise<this> {
    const activeMessages = await this.app.data.flowSessionRepository.upsertSystemPrompt(this.sessionData.id, content);
    this.sessionData.systemPrompt = content;
    this.sessionData.activeMessages = activeMessages;
    return this;
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
   * Load parent session context into this session.
   * The context (active messages excluding system, temp files, context files, context folders)
   * is formatted as XML and prepended to the first user message added via addUserMessage().
   * Call this after session creation but before the first addUserMessage().
   */
  async attachParentContext(): Promise<this> {
    if (!this.sessionData.parentSessionId) return this;
    const parent = await this.app.data.flowSessionRepository.getSession(this.sessionData.parentSessionId);
    if (!parent) return this;

    const parts: string[] = [];

    const userAndAssistantMessages = parent.activeMessages.filter(
      (m: SessionMessage) => (m.message as { role?: string }).role !== 'system',
    );
    if (userAndAssistantMessages.length > 0) {
      const msgsXml = userAndAssistantMessages
        .map((m: SessionMessage) => {
          const msg = m.message as { role?: string; content?: string };
          return `  <message role="${msg.role ?? 'unknown'}">${msg.content ?? ''}</message>`;
        })
        .join('\n');
      parts.push(`<messages>\n${msgsXml}\n</messages>`);
    }

    if (parent.tempFiles && parent.tempFiles.length > 0) {
      const filesXml = (parent.tempFiles as Array<{ name: string; content: string | Buffer }>)
        .map((f) => {
          const content = Buffer.isBuffer(f.content) ? '[binary content]' : f.content;
          return `  <file>\n    <name>${f.name}</name>\n    <content>${content}</content>\n  </file>`;
        })
        .join('\n');
      parts.push(`<temp_files>\n${filesXml}\n</temp_files>`);
    }

    if (parent.contextFiles && parent.contextFiles.length > 0) {
      const filesXml = (parent.contextFiles as Array<{ path: string }>)
        .map((f) => `  <file path="${f.path}" />`).join('\n');
      parts.push(`<context_files>\n${filesXml}\n</context_files>`);
    }

    if (parent.contextFoldersInfos && parent.contextFoldersInfos.length > 0) {
      const foldersXml = (parent.contextFoldersInfos as Array<{ path: string }>)
        .map((f) => `  <folder path="${f.path}" />`).join('\n');
      parts.push(`<context_folders>\n${foldersXml}\n</context_folders>`);
    }

    if (parts.length > 0) {
      this._parentContextXml = `<previous_session flowName="${parent.flowName}">\n${parts.join('\n')}\n</previous_session>`;
    }
    return this;
  }

  /**
   * Add a user message, prepending any existing temp files as formatted XML before the content.
   * Temp files are only attached when tempFiles is non-empty.
   * If attachParentContext() was called, its XML is also prepended on the first call.
   */
  async addUserMessage(message: UserMessage): Promise<this> {
    const content = message.toJSON().content as string;
    const tempFiles = this.sessionData.tempFiles;
    let fullContent = content;

    if (tempFiles && tempFiles.length > 0) {
      const filesXml = tempFiles
        .map((f) => {
          const content = Buffer.isBuffer(f.content) ? '[binary content]' : f.content;
          return `  <file>\n    <name>${f.name}</name>\n    <content>${content}</content>\n  </file>`;
        })
        .join('\n');
      fullContent = `<temp_files>\n${filesXml}\n</temp_files>\n<user_message>${fullContent}</user_message>`;
    }

    if (this._parentContextXml) {
      fullContent = `${this._parentContextXml}\n<user_message>${fullContent}</user_message>`;
      this._parentContextXml = null;
    }

    return this.addMessages([{ message: new UserMessage(fullContent).toJSON() }]);
  }

  /** Add a tool result message carrying a JSON-encoded error payload for the given tool call. */
  async addToolError(toolCallId: string, error: string): Promise<this> {
    return this.addMessages([
      {
        message: new ToolResultMessage({
          toolCallId,
          content: JSON.stringify({ error }),
        }).toJSON(),
      },
    ]);
  }

  // ─── Context / schema mutations ───────────────────────────────────────────

  async applySchema(schema: {
    systemPrompt: string;
    toolSchemas: ToolSchema[];
    skillSchemas: SkillSchema[];
    contextFiles: FileInfo[];
    contextFoldersInfos: FolderInfo[];
    callLlmOptions: SessionData['callLlmOptions'];
    messageWindowConfig: SessionData['messageWindowConfig'];
    userPromptTemplate: string | undefined;
    agentLoopConfig: SessionData['agentLoopConfig'];
    tools: AgentTool[];
  }): Promise<this> {
    await this.upsertSystemPrompt(schema.systemPrompt);
    this.sessionData.toolSchemas = schema.toolSchemas;
    this.sessionData.skillSchemas = schema.skillSchemas;
    this.sessionData.contextFiles = schema.contextFiles;
    this.sessionData.contextFoldersInfos = schema.contextFoldersInfos;
    this.sessionData.callLlmOptions = schema.callLlmOptions;
    this.sessionData.messageWindowConfig = schema.messageWindowConfig;
    this.sessionData.userPromptTemplate = schema.userPromptTemplate;
    this.sessionData.agentLoopConfig = schema.agentLoopConfig;
    this.tools = schema.tools;
    return this;
  }

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

  async writeTempFile(file: { name: string; content: string | Buffer }): Promise<this> {
    const tempFiles = await this.app.data.flowSessionRepository.writeTempFile(this.sessionData.id, file);
    this.sessionData.tempFiles = tempFiles;
    return this;
  }

  async removeTempFile(name: string): Promise<this> {
    const tempFiles = await this.app.data.flowSessionRepository.removeTempFile(this.sessionData.id, name);
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
  async respond(user: RuntimeUser, message: string): Promise<this> {
    console.log(`[Session.respond] sessionId=${this.sessionData.id} message=${message.slice(0, 80)}`);
    await this.addMessages([{ message: new AssistantTextMessage({ text: message }).toJSON() }]);
    const listenerCount = this.app.infra.bus.listenerCount('session:message');
    console.log(`[Session.respond] emitting session:message listenerCount=${listenerCount}`);
    this.app.infra.bus.emit('session:message', { session: this.sessionData, message, user: user });
    console.log(`[Session.respond] emitted session:message`);
    return this;
  }

  onUserMessage(cb: (payload: { session: SessionData; message: string; user: RuntimeUser }) => void) {
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
