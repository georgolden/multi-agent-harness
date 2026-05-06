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
import { randomUUID } from 'node:crypto';
import type { LlmStreamEvent } from '../../utils/callLlm.js';

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
  // Namespaced sandbox tools keyed by "{skillName}_{toolName}" — survive applySchema resets
  private _sandboxedTools: Map<string, AgentTool> = new Map();

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
      this._sandboxedTools.set(tool.name, tool);
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

  /** Persist the enabled skill record (name + empty sandboxToolNames) and register in-memory. */
  async enableSkill(name: string, entry: EnabledSkill): Promise<this> {
    await this.app.data.flowSessionRepository.enableSkill(this.sessionData.id, name);
    this.sessionData.enabledSkills = [
      ...this.sessionData.enabledSkills.filter((s) => s.name !== name),
      { name, sandboxToolNames: [] },
    ];
    this._enabledSkills.set(name, entry);
    return this;
  }

  /** Append skill SKILL.md to the system prompt and persist the enabled skill record. */
  async activateSkill(name: string, skill: import('../../skills/index.js').Skill, md: string): Promise<this> {
    const newPrompt = `${this.sessionData.systemPrompt}\n\n<skill name="${name}">\n${md}\n</skill>`;
    await this.upsertSystemPrompt(newPrompt);
    await this.enableSkill(name, { skill, sandboxSession: null });
    return this;
  }

  /**
   * Create (or reuse) a sandbox for the named skill. Registers namespaced tools
   * ("{skillName}_{toolName}") in both session.tools and session.toolSchemas so
   * the LLM sees them immediately. Persists sandboxToolNames into the DB record.
   * Returns `{ sandboxToolNames }` on success or `{ error }` on failure.
   */
  async ensureSkillSandbox(
    skillName: string,
    sandbox: SandboxService,
  ): Promise<{ sandboxToolNames?: string[]; error?: Error }> {
    const entry = this._enabledSkills.get(skillName);
    if (!entry) return { error: new Error(`Skill '${skillName}' not enabled`) };

    // Already has a live sandbox — nothing to do
    if (entry.sandboxSession) return { sandboxToolNames: this._sandboxToolNamesFor(skillName) };

    if (!entry.skill.runtime) return { sandboxToolNames: [] };

    try {
      const execSession = await sandbox.createSkillSession({ session: this, skill: entry.skill });
      const raw = sandbox.createSandboxedTools(execSession);
      entry.sandboxSession = execSession;

      const namespacedTools = [raw.bash, raw.read, raw.edit, raw.write].map((t) => ({
        ...t,
        name: `${skillName}_${t.name}`,
        label: `${skillName}_${t.name}`,
        description: `[${skillName} sandbox] ${t.description}`,
      }));

      this.addOrReplaceAgentTools(namespacedTools);

      // Extend toolSchemas so DecideAction/LLM sees the new tools
      const newSchemas = namespacedTools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
      this.sessionData.toolSchemas = [
        ...this.sessionData.toolSchemas.filter((s) => !newSchemas.some((ns) => ns.name === s.name)),
        ...newSchemas,
      ];

      const sandboxToolNames = namespacedTools.map((t) => t.name);

      // Persist sandboxToolNames into the DB record
      await this.app.data.flowSessionRepository.updateEnabledSkillRecord(this.sessionData.id, {
        name: skillName,
        sandboxToolNames,
      });
      this.sessionData.enabledSkills = this.sessionData.enabledSkills.map((r) =>
        r.name === skillName ? { ...r, sandboxToolNames } : r,
      );

      return { sandboxToolNames };
    } catch (err: any) {
      return { error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  private _sandboxToolNamesFor(skillName: string): string[] {
    return (this.sessionData.enabledSkills.find((r) => r.name === skillName)?.sandboxToolNames ?? []);
  }

  /**
   * Called by PrepareInput on every loop iteration.
   * After base tools are set via applySchema, this re-applies all sandboxed tools
   * and ensures every enabled skill with a runtime has a live sandbox.
   * Self-healing: recreates lost sandboxes on crash/restart.
   */
  async ensureSkillsReady(sandbox: SandboxService): Promise<void> {
    // Re-overlay all known sandboxed tools on top of the freshly reset base tools
    for (const [name, tool] of this._sandboxedTools) {
      const idx = this.tools.findIndex((t) => t.name === name);
      if (idx >= 0) this.tools[idx] = tool;
      else this.tools.push(tool);
    }

    // Ensure every enabled skill with a runtime has a live sandbox
    for (const record of this.sessionData.enabledSkills) {
      const entry = this._enabledSkills.get(record.name);
      if (!entry) continue;
      if (!entry.skill.runtime) continue;
      if (entry.sandboxSession) continue; // already live

      const result = await this.ensureSkillSandbox(record.name, sandbox);
      if (result.error) {
        console.warn(`[Session.ensureSkillsReady] sandbox restore failed for '${record.name}': ${result.error.message}`);
      }
    }
  }

  async disableSkill(name: string, sandbox?: SandboxService): Promise<this> {
    const entry = this._enabledSkills.get(name);
    if (!entry) return this;

    if (entry.sandboxSession && sandbox) {
      await sandbox.cleanupSkillSession({ session: this });
    }

    // Remove namespaced sandbox tools from session and schemas
    const sandboxToolNames = this._sandboxToolNamesFor(name);
    for (const toolName of sandboxToolNames) {
      this._sandboxedTools.delete(toolName);
      this.tools = this.tools.filter((t) => t.name !== toolName);
    }
    this.sessionData.toolSchemas = this.sessionData.toolSchemas.filter(
      (s) => !sandboxToolNames.includes(s.name),
    );

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

  /** Restore in-memory skill map from DB records (called on session load). */
  async rehydrateEnabledSkills(skills: Skills): Promise<this> {
    for (const record of this.sessionData.enabledSkills) {
      const skill = skills.getSkill(record.name);
      if (!skill) continue;
      this._enabledSkills.set(record.name, { skill, sandboxSession: null });
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
    const { allMessages, activeMessages } = await this.app.data.flowSessionRepository.upsertSystemPrompt(this.sessionData.id, content);
    this.sessionData.systemPrompt = content;
    this.sessionData.messages = allMessages;
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
    const { allMessages, activeMessages } = await this.app.data.flowSessionRepository.addMessages(this.sessionData.id, messages);
    this.sessionData.messages = allMessages;
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
    // Collect sandbox tool schemas from all currently enabled skills so they
    // survive the base-schema overwrite and are persisted to DB.
    const sandboxSchemas: ToolSchema[] = this.sessionData.enabledSkills.flatMap((r) =>
      (r.sandboxToolNames ?? []).flatMap((toolName) => {
        const tool = this._sandboxedTools.get(toolName);
        if (!tool) return [];
        return [{ name: tool.name, description: tool.description, parameters: tool.parameters as Record<string, unknown> }];
      }),
    );

    const mergedToolSchemas = [...schema.toolSchemas, ...sandboxSchemas];
    console.log(`[Session.applySchema] toolSchemas=${mergedToolSchemas.map((t) => t.name).join(',')} (${sandboxSchemas.length} sandbox)`);

    await this.upsertSystemPrompt(schema.systemPrompt);
    await this.app.data.flowSessionRepository.applySchema(this.sessionData.id, {
      toolSchemas: mergedToolSchemas,
      skillSchemas: schema.skillSchemas,
      contextFiles: schema.contextFiles,
      contextFoldersInfos: schema.contextFoldersInfos,
      callLlmOptions: schema.callLlmOptions as Record<string, unknown>,
      messageWindowConfig: schema.messageWindowConfig as unknown as Record<string, unknown>,
      agentLoopConfig: schema.agentLoopConfig as Record<string, unknown>,
      userPromptTemplate: schema.userPromptTemplate,
    });
    this.sessionData.toolSchemas = mergedToolSchemas;
    this.sessionData.skillSchemas = schema.skillSchemas;
    this.sessionData.contextFiles = schema.contextFiles;
    this.sessionData.contextFoldersInfos = schema.contextFoldersInfos;
    this.sessionData.callLlmOptions = schema.callLlmOptions;
    this.sessionData.messageWindowConfig = schema.messageWindowConfig;
    this.sessionData.userPromptTemplate = schema.userPromptTemplate;
    this.sessionData.agentLoopConfig = schema.agentLoopConfig;
    this.tools = [...schema.tools];
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
    this._emitMessage(user, message);
    return this;
  }

  /**
   * Consume an LLM stream and re-emit text/reasoning deltas onto the bus as
   * `session:stream:start` / `session:stream:delta` / `session:stream:end`.
   * Each call gets a fresh streamId so the UI can bind chunks to a single
   * in-progress assistant message. Fire-and-forget for the bus side: errors
   * iterating the stream are swallowed (the LLM call itself surfaces them via finalResult).
   */
  async streamToBus(stream: AsyncIterable<LlmStreamEvent>): Promise<void> {
    const streamId = randomUUID();
    const bus = this.app.infra.bus;
    const sessionId = this.sessionData.id;
    const userId = this.sessionData.userId;

    bus.emit('session:stream:start', { sessionId, userId, streamId });
    try {
      for await (const ev of stream) {
        if (ev.type === 'text-delta') {
          bus.emit('session:stream:delta', { sessionId, userId, streamId, kind: 'text', text: ev.text });
        } else if (ev.type === 'reasoning-delta') {
          bus.emit('session:stream:delta', { sessionId, userId, streamId, kind: 'reasoning', text: ev.text });
        }
      }
    } catch {
      // ignore — finalResult promise carries the real error
    } finally {
      bus.emit('session:stream:end', { sessionId, userId, streamId });
    }
  }

  /** Emit session:message to listeners without adding it to message history. */
  notify(user: RuntimeUser, message: string): this {
    console.log(`[Session.notify] sessionId=${this.sessionData.id} message=${message.slice(0, 80)}`);
    this._emitMessage(user, message);
    return this;
  }

  private _emitMessage(user: RuntimeUser, message: string): void {
    const listenerCount = this.app.infra.bus.listenerCount('session:message');
    console.log(`[Session.respond] emitting session:message listenerCount=${listenerCount}`);
    this.app.infra.bus.emit('session:message', { session: this.sessionData, message, user: user });
    console.log(`[Session.respond] emitted session:message`);
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
