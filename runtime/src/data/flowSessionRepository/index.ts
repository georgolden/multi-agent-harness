import type { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import type {
  SessionData,
  SessionDataTreeNode,
  SessionMessage,
  ToolSchema,
  SkillSchema,
  ToolLog,
  SkillLog,
  SessionStatus,
  CreateSessionParams,
} from '../../services/sessionService/types.js';
import type { FileInfo } from '../../utils/file.js';
import type { FolderInfo } from '../../utils/folder.js';
import { DEFAULT_MESSAGE_WINDOW_CONFIG } from '../../services/sessionService/types.js';
import { App } from '../../app.js';
import { computeActiveWindow } from './messageWindow.js';

/** Any Prisma client or interactive-transaction client */
type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Storage-boundary encoding for tempFiles: Buffer round-trips through the JSON
 * column as base64 with a marker. The Session API surface keeps `string | Buffer`
 * identity intact; this is invisible to callers.
 */
function encodeTempFileForStorage(file: {
  name: string;
  content: string | Buffer;
}): { name: string; content: string; encoding?: 'base64' } {
  if (Buffer.isBuffer(file.content)) {
    return { name: file.name, content: file.content.toString('base64'), encoding: 'base64' };
  }
  return { name: file.name, content: file.content };
}

/** Per-session transaction state managed internally by the repository */
interface SessionTxState {
  tx: TxClient;
  commit: () => void;
  rollback: (err: unknown) => void;
}

export class SessionDataRepository {
  private prisma: PrismaClient;
  app: App;

  /** Active node transactions keyed by sessionId */
  private _txMap = new Map<string, SessionTxState>();

  constructor(app: App) {
    this.app = app;
    this.prisma = app.infra.prisma.client;
  }

  private _client(sessionId: string): TxClient | PrismaClient {
    return (this._txMap.get(sessionId)?.tx ?? this.prisma) as any;
  }

  // ─── Node transaction ─────────────────────────────────────────────────────

  /**
   * Open a Prisma interactive transaction for the given session.
   * All subsequent mutations for this session will be routed through it
   * until commitNodeTransaction or rollbackNodeTransaction is called.
   */
  async beginNodeTransaction(sessionId: string): Promise<void> {
    if (this._txMap.has(sessionId)) return; // already open
    await new Promise<void>((outerResolve, outerReject) => {
      this.prisma
        .$transaction((tx) => {
          this._txMap.set(sessionId, {
            tx: tx as TxClient,
            commit: null!,
            rollback: null!,
          });
          outerResolve();
          return new Promise<void>((commit, rollback) => {
            const state = this._txMap.get(sessionId)!;
            state.commit = commit;
            state.rollback = rollback;
          });
        }, { timeout: 600_000 }) // 10 minutes — LLM calls can take 60s+
        .catch((err) => {
          this._txMap.delete(sessionId);
          outerReject(err);
        });
    });
  }

  /**
   * Atomically write the checkpoint fields and commit the open transaction.
   */
  async commitNodeTransaction(sessionId: string, nodeName: string, packetData: unknown): Promise<void> {
    const state = this._txMap.get(sessionId);
    if (!state) return;
    await (state.tx as any).flowSession.update({
      where: { id: sessionId },
      data: { currentNodeName: nodeName, currentPacketData: packetData as any },
    });
    console.log(`[SessionDataRepository] Checkpoint set for session '${sessionId}' at node '${nodeName}'`);
    this._txMap.delete(sessionId);
    state.commit();
  }

  /** Roll back the open transaction (no-op if none is open). */
  async rollbackNodeTransaction(sessionId: string): Promise<void> {
    const state = this._txMap.get(sessionId);
    if (!state) return;
    this._txMap.delete(sessionId);
    state.rollback(new Error('Node transaction rolled back'));
  }

  async setFlowSchema(sessionId: string, schema: unknown): Promise<void> {
    const client = this._client(sessionId) as any;
    await client.flowSession.update({
      where: { id: sessionId },
      data: { flowSchema: schema as any },
    });
  }

  async start(): Promise<void> {
    console.log('[SessionDataRepository] Ready');
  }

  async stop(): Promise<void> {}

  generateSessionId(): string {
    return randomBytes(8).toString('hex');
  }

  private mapRow(row: any): SessionData {
    return {
      id: row.id,
      userId: row.userId,
      flowName: row.flowName,
      systemPrompt: row.systemPrompt,
      userPromptTemplate: row.userPromptTemplate,
      status: row.status,
      parentSessionId: row.parentSessionId ?? undefined,
      messages: (row.messages as SessionMessage[]) || [],
      activeMessages: (row.activeMessages as SessionMessage[]) || [],
      messageWindowConfig: row.messageWindowConfig ?? DEFAULT_MESSAGE_WINDOW_CONFIG,
      contextFiles: (row.contextFiles as FileInfo[]) || [],
      contextFoldersInfos: (row.contextFoldersInfos as FolderInfo[]) || [],
      toolSchemas: (row.toolSchemas as ToolSchema[]) || [],
      skillSchemas: (row.skillSchemas as SkillSchema[]) || [],
      tempFiles: ((row.tempFiles as Array<{ name: string; content: string; encoding?: 'base64' }>) || []).map(
        (f) =>
          f.encoding === 'base64'
            ? { name: f.name, content: Buffer.from(f.content, 'base64') }
            : { name: f.name, content: f.content as string },
      ),
      callLlmOptions: (row.callLlmOptions as Record<string, any>) || {},
      agentLoopConfig: (row.agentLoopConfig as any) || {},
      toolLogs: (row.toolLogs as ToolLog[]) || [],
      skillLogs: (row.skillLogs as SkillLog[]) || [],
      startedAt: row.startedAt,
      endedAt: row.endedAt ?? undefined,
      flowSchema: row.flowSchema ?? undefined,
      currentNodeName: row.currentNodeName ?? undefined,
      currentPacketData: row.currentPacketData ?? undefined,
      agentSessionId: row.agentSessionId ?? undefined,
    };
  }

  async createSession(params: CreateSessionParams): Promise<SessionData> {
    const id = params.sessionId ?? this.generateSessionId();
    const config = params.messageWindowConfig ?? DEFAULT_MESSAGE_WINDOW_CONFIG;

    const row = await this.prisma.flowSession.create({
      data: {
        id,
        userId: params.userId,
        flowName: params.flowName,
        systemPrompt: params.systemPrompt || '',
        userPromptTemplate: params.userPromptTemplate,
        status: 'running',
        parentSessionId: params.parentSessionId,
        messageWindowConfig: config as any,
        toolSchemas: (params.tools ?? []) as any,
        skillSchemas: (params.skills ?? []) as any,
        contextFiles: (params.contextFiles ?? []) as any,
        contextFoldersInfos: (params.contextFoldersInfos ?? []) as any,
        callLlmOptions: params.callLlmOptions as any,
        agentLoopConfig: params.agentLoopConfig as any,
        agentSessionId: params.agentSessionId,
      },
    });

    const session = this.mapRow(row);
    this.app.infra.bus.emit('flowSession:created', session);
    console.log(`[SessionDataRepository] Created session '${id}' for flow '${params.flowName}'`);
    return session;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    const row = await this.prisma.flowSession.findUnique({ where: { id: sessionId } });
    return row ? this.mapRow(row) : null;
  }

  async getUserSessions(userId: string, status?: SessionStatus): Promise<SessionData[]> {
    const rows = await this.prisma.flowSession.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { startedAt: 'desc' },
    });
    return rows.map((r) => this.mapRow(r));
  }

  async getByAgentSessionId(agentSessionId: string): Promise<SessionData[]> {
    const rows = await this.prisma.flowSession.findMany({
      where: { agentSessionId },
      orderBy: { startedAt: 'asc' },
    });
    return rows.map((r) => this.mapRow(r));
  }

  async linkToAgentSession(flowSessionId: string, agentSessionId: string): Promise<void> {
    await this.prisma.flowSession.update({
      where: { id: flowSessionId },
      data: { agentSessionId },
    });
  }

  async updateStatus(sessionId: string, status: SessionStatus): Promise<void> {
    const client = this._client(sessionId) as any;
    await client.flowSession.update({
      where: { id: sessionId },
      data: {
        status,
        ...(status === 'completed' || status === 'failed' ? { endedAt: new Date() } : {}),
      },
    });
    this.app.infra.bus.emit('flowSession:statusUpdated', { sessionId, status });
    console.log(`[SessionDataRepository] Updated session '${sessionId}' status to '${status}'`);
  }

  /**
   * Replace the system prompt message (always the first message) in-place.
   * Also updates the `systemPrompt` column and rewrites both `messages` and
   * `activeMessages` so every future active window sees the updated prompt.
   */
  async upsertSystemPrompt(sessionId: string, content: string): Promise<SessionMessage[]> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const systemMsg: SessionMessage = {
      timestamp: new Date(),
      message: { role: 'system', content },
    };

    const allMessages: SessionMessage[] =
      session.messages.length > 0 && (session.messages[0].message as any)?.role === 'system'
        ? [systemMsg, ...session.messages.slice(1)]
        : [systemMsg, ...session.messages];

    const activeMessages = computeActiveWindow(allMessages, session.messageWindowConfig);

    const client = this._client(sessionId) as any;
    await client.flowSession.update({
      where: { id: sessionId },
      data: { systemPrompt: content, messages: allMessages as any, activeMessages: activeMessages as any },
    });

    console.log(`[SessionDataRepository] Upserted system prompt for session '${sessionId}'`);
    return activeMessages;
  }

  async addMessages(
    sessionId: string,
    messages: Omit<SessionMessage, 'timestamp'>[],
  ): Promise<SessionMessage[]> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const fullMessages: SessionMessage[] = messages.map((msg) => ({ timestamp: new Date(), ...msg }));
    const allMessages = [...session.messages, ...fullMessages];
    const activeMessages = computeActiveWindow(allMessages, session.messageWindowConfig);

    const client = this._client(sessionId) as any;
    await client.flowSession.update({
      where: { id: sessionId },
      data: { messages: allMessages as any, activeMessages: activeMessages as any },
    });

    this.app.infra.bus.emit('flowSession:messagesAdded', { sessionId, activeMessages, allMessages });
    console.log(`[SessionDataRepository] Added ${messages.length} messages to session '${sessionId}'`);
    return activeMessages;
  }

  async addContextFiles(sessionId: string, files: FileInfo[]): Promise<FileInfo[]> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const contextFiles = [...session.contextFiles, ...files];
    const client = this._client(sessionId) as any;
    await client.flowSession.update({ where: { id: sessionId }, data: { contextFiles: contextFiles as any } });
    this.app.infra.bus.emit('flowSession:contextFilesAdded', { sessionId, contextFiles });
    console.log(`[SessionDataRepository] Added ${files.length} context files to session '${sessionId}'`);
    return contextFiles;
  }

  async addContextFoldersInfos(sessionId: string, folders: FolderInfo[]): Promise<FolderInfo[]> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const contextFoldersInfos = [...session.contextFoldersInfos, ...folders];
    const client = this._client(sessionId) as any;
    await client.flowSession.update({
      where: { id: sessionId },
      data: { contextFoldersInfos: contextFoldersInfos as any },
    });
    this.app.infra.bus.emit('flowSession:contextFoldersInfosAdded', { sessionId, contextFoldersInfos });
    console.log(`[SessionDataRepository] Added ${folders.length} context folder infos to session '${sessionId}'`);
    return contextFoldersInfos;
  }

  async addTools(sessionId: string, tools: ToolSchema[]): Promise<ToolSchema[]> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const allTools = [...session.toolSchemas, ...tools];
    const client = this._client(sessionId) as any;
    await client.flowSession.update({ where: { id: sessionId }, data: { toolSchemas: allTools as any } });
    this.app.infra.bus.emit('flowSession:toolsAdded', { sessionId, tools: allTools });
    console.log(`[SessionDataRepository] Added ${tools.length} tools to session '${sessionId}'`);
    return allTools;
  }

  async addSkills(sessionId: string, skills: SkillSchema[]): Promise<SkillSchema[]> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const allSkills = [...session.skillSchemas, ...skills];
    const client = this._client(sessionId) as any;
    await client.flowSession.update({ where: { id: sessionId }, data: { skillSchemas: allSkills as any } });
    this.app.infra.bus.emit('flowSession:skillsAdded', { sessionId, skills: allSkills });
    console.log(`[SessionDataRepository] Added ${skills.length} skills to session '${sessionId}'`);
    return allSkills;
  }

  async writeTempFile(
    sessionId: string,
    file: { name: string; content: string | Buffer },
  ): Promise<Array<{ name: string; content: string | Buffer }>> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const existing = session.tempFiles ?? [];
    const idx = existing.findIndex((f) => f.name === file.name);
    const tempFiles = idx >= 0 ? existing.map((f, i) => (i === idx ? file : f)) : [...existing, file];

    const client = this._client(sessionId) as any;
    await client.flowSession.update({
      where: { id: sessionId },
      data: { tempFiles: tempFiles.map(encodeTempFileForStorage) as any },
    });
    this.app.infra.bus.emit('flowSession:tempFileWritten', { sessionId, file, tempFiles });
    console.log(`[SessionDataRepository] Wrote temp file '${file.name}' to session '${sessionId}'`);
    return tempFiles;
  }

  async removeTempFile(
    sessionId: string,
    name: string,
  ): Promise<Array<{ name: string; content: string | Buffer }>> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const tempFiles = (session.tempFiles ?? []).filter((f) => f.name !== name);
    const client = this._client(sessionId) as any;
    await client.flowSession.update({
      where: { id: sessionId },
      data: { tempFiles: tempFiles.map(encodeTempFileForStorage) as any },
    });
    this.app.infra.bus.emit('flowSession:tempFileRemoved', { sessionId, name, tempFiles });
    console.log(`[SessionDataRepository] Removed temp file '${name}' from session '${sessionId}'`);
    return tempFiles;
  }

  async logToolExecution(sessionId: string, log: ToolLog): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const toolLogs = [...session.toolLogs, log];
    const client = this._client(sessionId) as any;
    await client.flowSession.update({ where: { id: sessionId }, data: { toolLogs: toolLogs as any } });

    const durationMs = log.endedAt.getTime() - log.startedAt.getTime();
    this.app.infra.bus.emit('flowSession:toolExecuted', { sessionId, log, durationMs, allLogs: toolLogs });
    console.log(`[SessionDataRepository] Logged tool '${log.name}' execution for session '${sessionId}'`);
  }

  async logSkillExecution(sessionId: string, log: SkillLog): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const skillLogs = [...session.skillLogs, log];
    const client = this._client(sessionId) as any;
    await client.flowSession.update({ where: { id: sessionId }, data: { skillLogs: skillLogs as any } });

    const durationMs = log.endedAt.getTime() - log.startedAt.getTime();
    this.app.infra.bus.emit('flowSession:skillExecuted', { sessionId, log, durationMs, allLogs: skillLogs });
    console.log(`[SessionDataRepository] Logged skill '${log.name}' execution for session '${sessionId}'`);
  }

  async getChildren(parentSessionId: string): Promise<SessionData[]> {
    const rows = await this.prisma.flowSession.findMany({
      where: { parentSessionId },
      orderBy: { startedAt: 'asc' },
    });
    return rows.map((r) => this.mapRow(r));
  }

  async getChildrenTreeNodes(parentSessionId: string): Promise<SessionDataTreeNode[]> {
    const rows = await this.prisma.flowSession.findMany({
      where: { parentSessionId },
      orderBy: { startedAt: 'asc' },
      select: {
        id: true,
        userId: true,
        flowName: true,
        status: true,
        parentSessionId: true,
        startedAt: true,
        _count: { select: { children: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      flowName: row.flowName,
      status: row.status as SessionStatus,
      parentSessionId: row.parentSessionId ?? undefined,
      createdAt: row.startedAt,
      childCount: row._count.children,
    }));
  }

  async getParent(sessionId: string): Promise<SessionData | null> {
    const session = await this.getSession(sessionId);
    if (!session?.parentSessionId) return null;
    return this.getSession(session.parentSessionId);
  }

  async getRootSessions(userId: string): Promise<SessionData[]> {
    const rows = await this.prisma.flowSession.findMany({
      where: { userId, parentSessionId: null },
      orderBy: { startedAt: 'desc' },
    });
    return rows.map((r) => this.mapRow(r));
  }

  async getSessionPath(sessionId: string): Promise<SessionData[]> {
    const path: SessionData[] = [];
    let currentId: string | undefined = sessionId;
    while (currentId) {
      const session = await this.getSession(currentId);
      if (!session) break;
      path.unshift(session);
      currentId = session.parentSessionId;
    }
    return path;
  }

  async getSubtree(sessionId: string): Promise<SessionData[]> {
    const subtree: SessionData[] = [];
    const queue: string[] = [sessionId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const session = await this.getSession(currentId);
      if (session) {
        subtree.push(session);
        const children = await this.getChildren(currentId);
        queue.push(...children.map((c) => c.id));
      }
    }
    return subtree;
  }

  async getTreeStats(sessionId: string): Promise<{ depth: number; descendantCount: number; childCount: number }> {
    const path = await this.getSessionPath(sessionId);
    const children = await this.getChildren(sessionId);
    const subtree = await this.getSubtree(sessionId);
    return {
      depth: path.length - 1,
      childCount: children.length,
      descendantCount: subtree.length - 1,
    };
  }

  async deleteSession(sessionId: string, deleteDescendants: boolean = false): Promise<boolean> {
    if (deleteDescendants) {
      const subtree = await this.getSubtree(sessionId);
      const ids = subtree.map((s) => s.id);
      if (ids.length > 0) {
        await this.prisma.flowSession.deleteMany({ where: { id: { in: ids } } });
        this.app.infra.bus.emit('flowSession:deleted', { sessionId, ids, deletedCount: ids.length, withDescendants: true });
        console.log(`[SessionDataRepository] Deleted session '${sessionId}' and ${ids.length - 1} descendants`);
      }
    } else {
      try {
        await this.prisma.flowSession.delete({ where: { id: sessionId } });
        this.app.infra.bus.emit('flowSession:deleted', { sessionId, deletedCount: 1, withDescendants: false });
        console.log(`[SessionDataRepository] Deleted session '${sessionId}'`);
      } catch {
        console.log(`[SessionDataRepository] Session '${sessionId}' not found`);
        return false;
      }
    }
    return true;
  }
}
