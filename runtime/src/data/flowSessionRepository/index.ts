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

export class SessionDataRepository {
  private prisma: PrismaClient;
  app: App;

  constructor(app: App) {
    this.app = app;
    this.prisma = app.infra.prisma.client;
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
      tempFiles: (row.tempFiles as { name: string; content: string }[]) || [],
      callLlmOptions: (row.callLlmOptions as Record<string, any>) || {},
      agentLoopConfig: (row.agentLoopConfig as any) || {},
      toolLogs: (row.toolLogs as ToolLog[]) || [],
      skillLogs: (row.skillLogs as SkillLog[]) || [],
      startedAt: row.startedAt,
      endedAt: row.endedAt ?? undefined,
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
        systemPrompt: params.systemPrompt,
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

  async updateStatus(sessionId: string, status: SessionStatus): Promise<void> {
    await this.prisma.flowSession.update({
      where: { id: sessionId },
      data: {
        status,
        ...(status === 'completed' || status === 'failed' ? { endedAt: new Date() } : {}),
      },
    });
    this.app.infra.bus.emit('flowSession:statusUpdated', { sessionId, status });
    console.log(`[SessionDataRepository] Updated session '${sessionId}' status to '${status}'`);
  }

  async addMessages(sessionId: string, messages: Omit<SessionMessage, 'timestamp'>[]): Promise<SessionMessage[]> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const fullMessages: SessionMessage[] = messages.map((msg) => ({ timestamp: new Date(), ...msg }));
    const allMessages = [...session.messages, ...fullMessages];
    const activeMessages = computeActiveWindow(allMessages, session.messageWindowConfig);

    await this.prisma.flowSession.update({
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
    await this.prisma.flowSession.update({ where: { id: sessionId }, data: { contextFiles: contextFiles as any } });
    this.app.infra.bus.emit('flowSession:contextFilesAdded', { sessionId, contextFiles });
    console.log(`[SessionDataRepository] Added ${files.length} context files to session '${sessionId}'`);
    return contextFiles;
  }

  async addContextFoldersInfos(sessionId: string, folders: FolderInfo[]): Promise<FolderInfo[]> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const contextFoldersInfos = [...session.contextFoldersInfos, ...folders];
    await this.prisma.flowSession.update({
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
    await this.prisma.flowSession.update({ where: { id: sessionId }, data: { toolSchemas: allTools as any } });
    this.app.infra.bus.emit('flowSession:toolsAdded', { sessionId, tools: allTools });
    console.log(`[SessionDataRepository] Added ${tools.length} tools to session '${sessionId}'`);
    return allTools;
  }

  async addSkills(sessionId: string, skills: SkillSchema[]): Promise<SkillSchema[]> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const allSkills = [...session.skillSchemas, ...skills];
    await this.prisma.flowSession.update({ where: { id: sessionId }, data: { skillSchemas: allSkills as any } });
    this.app.infra.bus.emit('flowSession:skillsAdded', { sessionId, skills: allSkills });
    console.log(`[SessionDataRepository] Added ${skills.length} skills to session '${sessionId}'`);
    return allSkills;
  }

  async writeTempFile(
    sessionId: string,
    file: { name: string; content: string },
  ): Promise<Array<{ name: string; content: string }>> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const existing = session.tempFiles ?? [];
    const idx = existing.findIndex((f) => f.name === file.name);
    const tempFiles = idx >= 0 ? existing.map((f, i) => (i === idx ? file : f)) : [...existing, file];

    await this.prisma.flowSession.update({ where: { id: sessionId }, data: { tempFiles: tempFiles as any } });
    this.app.infra.bus.emit('flowSession:tempFileWritten', { sessionId, file, tempFiles });
    console.log(`[SessionDataRepository] Wrote temp file '${file.name}' to session '${sessionId}'`);
    return tempFiles;
  }

  async logToolExecution(sessionId: string, log: ToolLog): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const toolLogs = [...session.toolLogs, log];
    await this.prisma.flowSession.update({ where: { id: sessionId }, data: { toolLogs: toolLogs as any } });

    const durationMs = log.endedAt.getTime() - log.startedAt.getTime();
    this.app.infra.bus.emit('flowSession:toolExecuted', { sessionId, log, durationMs, allLogs: toolLogs });
    console.log(`[SessionDataRepository] Logged tool '${log.name}' execution for session '${sessionId}'`);
  }

  async logSkillExecution(sessionId: string, log: SkillLog): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session '${sessionId}' not found`);

    const skillLogs = [...session.skillLogs, log];
    await this.prisma.flowSession.update({ where: { id: sessionId }, data: { skillLogs: skillLogs as any } });

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
