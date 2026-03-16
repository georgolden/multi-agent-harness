/**
 * SessionDataRepository for managing flow execution sessions with tree structure.
 * Uses Postgres for persistence with JSONB for complex data types.
 * Emits events for observability.
 */
import type { Pool } from 'pg';
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

/**
 * SessionDataRepository for managing flow sessions with tree structure and smart message windowing
 */
export class SessionDataRepository {
  private pool: Pool;
  app: App;

  constructor(app: App) {
    this.app = app;
    this.pool = app.infra.pg.pool;
  }

  /**
   * Initialize database tables and indexes for flow sessions
   */
  async start(): Promise<void> {
    // Create flow_sessions table with tree structure support
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS flow_sessions (
        id VARCHAR(16) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        flow_name VARCHAR(255) NOT NULL,
        system_prompt TEXT NOT NULL,
        user_prompt_template TEXT,
        status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'completed', 'failed')),

        -- Tree structure
        parent_session_id VARCHAR(16) REFERENCES flow_sessions(id) ON DELETE SET NULL,

        -- Message history (stored as JSONB)
        messages JSONB NOT NULL DEFAULT '[]',
        active_messages JSONB NOT NULL DEFAULT '[]',
        message_window_config JSONB NOT NULL,

        -- Context and tools (stored as JSONB)
        context_files JSONB NOT NULL DEFAULT '[]',
        context_folders_infos JSONB NOT NULL DEFAULT '[]',
        tool_schemas JSONB NOT NULL DEFAULT '[]',
        skill_schemas JSONB NOT NULL DEFAULT '[]',

        -- LLM and agent configuration
        call_llm_options JSONB NOT NULL DEFAULT '{}',
        agent_loop_config JSONB NOT NULL DEFAULT '{}',

        -- Temporary files (stored as JSONB)
        temp_files JSONB NOT NULL DEFAULT '[]',

        -- Execution logs (stored as JSONB)
        tool_logs JSONB NOT NULL DEFAULT '[]',
        skill_logs JSONB NOT NULL DEFAULT '[]',

        -- Timestamps - simple
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMP
      )
    `);

    // Create indexes for efficient queries
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_flow_sessions_user_id
      ON flow_sessions(user_id)
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_flow_sessions_parent_id
      ON flow_sessions(parent_session_id)
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_flow_sessions_status
      ON flow_sessions(status)
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_flow_sessions_user_status
      ON flow_sessions(user_id, status)
    `);

    // Create index for tree traversal
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_flow_sessions_tree
      ON flow_sessions(parent_session_id, started_at)
    `);

    console.log('[SessionDataRepository] Initialized with Postgres');
  }

  /**
   * Cleanup (pool is managed by infra layer)
   */
  async stop(): Promise<void> {
    console.log('[SessionDataRepository] Stopped');
  }

  /**
   * Generate a unique flow session ID (random UUID)
   */
  generateSessionId(): string {
    return randomBytes(8).toString('hex');
  }

  /**
   * Map database row to SessionData type
   */
  private mapDbRowToSession(row: any): SessionData {
    return {
      id: row.id,
      userId: row.user_id,
      flowName: row.flow_name,
      systemPrompt: row.system_prompt,
      userPromptTemplate: row.user_prompt_template,
      status: row.status,
      parentSessionId: row.parent_session_id,
      messages: row.messages || [],
      activeMessages: row.active_messages || [],
      messageWindowConfig: row.message_window_config || DEFAULT_MESSAGE_WINDOW_CONFIG,
      contextFiles: row.context_files || [],
      contextFoldersInfos: row.context_folders_infos || [],
      toolSchemas: row.tool_schemas || [],
      skillSchemas: row.skill_schemas || [],
      tempFiles: row.temp_files || [],
      callLlmOptions: row.call_llm_options || {},
      agentLoopConfig: row.agent_loop_config || {},
      toolLogs: row.tool_logs || [],
      skillLogs: row.skill_logs || [],
      startedAt: row.started_at,
      endedAt: row.ended_at,
    };
  }

  /**
   * Create a new flow session
   */
  async createSession(params: CreateSessionParams): Promise<SessionData> {
    const id = params.sessionId || this.generateSessionId();
    const config = params.messageWindowConfig || DEFAULT_MESSAGE_WINDOW_CONFIG;
    const toolSchemas = params.tools || [];
    const skillSchemas = params.skills || [];
    const contextFiles = params.contextFiles || [];
    const contextFoldersInfos = params.contextFoldersInfos || [];

    const result = await this.pool.query(
      `INSERT INTO flow_sessions (
        id, user_id, flow_name, system_prompt, user_prompt_template,
        status, parent_session_id, message_window_config,
        tool_schemas, skill_schemas, context_files, context_folders_infos,
        call_llm_options, agent_loop_config
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        id,
        params.userId,
        params.flowName,
        params.systemPrompt,
        params.userPromptTemplate,
        'running',
        params.parentSessionId,
        JSON.stringify(config),
        JSON.stringify(toolSchemas),
        JSON.stringify(skillSchemas),
        JSON.stringify(contextFiles),
        JSON.stringify(contextFoldersInfos),
        JSON.stringify(params.callLlmOptions),
        JSON.stringify(params.agentLoopConfig),
      ],
    );

    const session = this.mapDbRowToSession(result.rows[0]);

    // Emit event
    this.app.infra.bus.emit('flowSession:created', session);

    console.log(`[SessionDataRepository] Created session '${id}' for flow '${params.flowName}'`);
    return session;
  }

  /**
   * Get a flow session by ID
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    const result = await this.pool.query('SELECT * FROM flow_sessions WHERE id = $1', [sessionId]);
    return result.rows[0] ? this.mapDbRowToSession(result.rows[0]) : null;
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: string, status?: SessionStatus): Promise<SessionData[]> {
    let query = 'SELECT * FROM flow_sessions WHERE user_id = $1';
    const params: any[] = [userId];

    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }

    query += ' ORDER BY started_at DESC';

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => this.mapDbRowToSession(row));
  }

  /**
   * Update session status
   */
  async updateStatus(sessionId: string, status: SessionStatus): Promise<void> {
    const setClauses = ['status = $2'];
    const params: any[] = [sessionId, status];

    if (status === 'completed' || status === 'failed') {
      setClauses.push('ended_at = NOW()');
    }

    await this.pool.query(`UPDATE flow_sessions SET ${setClauses.join(', ')} WHERE id = $1`, params);

    // Emit event
    this.app.infra.bus.emit('flowSession:statusUpdated', {
      sessionId,
      status,
    });

    console.log(`[SessionDataRepository] Updated session '${sessionId}' status to '${status}'`);
  }

  /**
   * Add messages to the session and automatically manage the active window.
   * Returns the updated active messages.
   */
  async addMessages(sessionId: string, messages: Omit<SessionMessage, 'timestamp'>[]): Promise<SessionMessage[]> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    // Create full messages with timestamps
    const fullMessages: SessionMessage[] = messages.map((msg) => ({
      timestamp: new Date(),
      ...msg,
    }));

    // Add to messages array
    const allMessages = [...session.messages, ...fullMessages];

    // Compute active messages window
    const activeMessages = computeActiveWindow(allMessages, session.messageWindowConfig);

    await this.pool.query(
      `UPDATE flow_sessions
       SET messages = $2, active_messages = $3
       WHERE id = $1`,
      [sessionId, JSON.stringify(allMessages), JSON.stringify(activeMessages)],
    );

    // Emit event
    this.app.infra.bus.emit('flowSession:messagesAdded', {
      sessionId,
      activeMessages,
      allMessages,
    });

    console.log(`[SessionDataRepository] Added ${messages.length} messages to session '${sessionId}'`);
    return activeMessages;
  }

  /**
   * Add context files to the session
   */
  async addContextFiles(sessionId: string, files: FileInfo[]): Promise<FileInfo[]> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    const contextFiles = [...session.contextFiles, ...files];

    await this.pool.query(`UPDATE flow_sessions SET context_files = $2 WHERE id = $1`, [
      sessionId,
      JSON.stringify(contextFiles),
    ]);

    // Emit event
    this.app.infra.bus.emit('flowSession:contextFilesAdded', {
      sessionId,
      contextFiles,
    });

    console.log(`[SessionDataRepository] Added ${files.length} context files to session '${sessionId}'`);
    return contextFiles;
  }

  /**
   * Add context folder infos to the session
   */
  async addContextFoldersInfos(sessionId: string, folders: FolderInfo[]): Promise<FolderInfo[]> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    const contextFoldersInfos = [...session.contextFoldersInfos, ...folders];

    await this.pool.query(`UPDATE flow_sessions SET context_folders_infos = $2 WHERE id = $1`, [
      sessionId,
      JSON.stringify(contextFoldersInfos),
    ]);

    this.app.infra.bus.emit('flowSession:contextFoldersInfosAdded', {
      sessionId,
      contextFoldersInfos,
    });

    console.log(`[SessionDataRepository] Added ${folders.length} context folder infos to session '${sessionId}'`);
    return contextFoldersInfos;
  }

  /**
   * Add tool schemas to the session
   */
  async addTools(sessionId: string, tools: ToolSchema[]): Promise<ToolSchema[]> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    const allTools = [...session.toolSchemas, ...tools];

    await this.pool.query(`UPDATE flow_sessions SET tool_schemas = $2 WHERE id = $1`, [
      sessionId,
      JSON.stringify(allTools),
    ]);

    // Emit event
    this.app.infra.bus.emit('flowSession:toolsAdded', {
      sessionId,
      tools: allTools,
    });

    console.log(`[SessionDataRepository] Added ${tools.length} tools to session '${sessionId}'`);
    return allTools;
  }

  /**
   * Add skill schemas to the session
   */
  async addSkills(sessionId: string, skills: SkillSchema[]): Promise<SkillSchema[]> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    const allSkills = [...session.skillSchemas, ...skills];

    await this.pool.query(`UPDATE flow_sessions SET skill_schemas = $2 WHERE id = $1`, [
      sessionId,
      JSON.stringify(allSkills),
    ]);

    // Emit event
    this.app.infra.bus.emit('flowSession:skillsAdded', {
      sessionId,
      skills: allSkills,
    });

    console.log(`[SessionDataRepository] Added ${skills.length} skills to session '${sessionId}'`);
    return allSkills;
  }

  /**
   * Write (upsert) a temporary file in the session.
   * If a file with the same name exists it is replaced; otherwise it is appended.
   * Returns the full updated tempFiles array.
   */
  async writeTempFile(
    sessionId: string,
    file: { name: string; content: string },
  ): Promise<Array<{ name: string; content: string }>> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    const existing = session.tempFiles ?? [];
    const idx = existing.findIndex((f) => f.name === file.name);
    const tempFiles = idx >= 0 ? existing.map((f, i) => (i === idx ? file : f)) : [...existing, file];

    await this.pool.query(`UPDATE flow_sessions SET temp_files = $2 WHERE id = $1`, [
      sessionId,
      JSON.stringify(tempFiles),
    ]);

    this.app.infra.bus.emit('flowSession:tempFileWritten', { sessionId, file, tempFiles });

    console.log(`[SessionDataRepository] Wrote temp file '${file.name}' to session '${sessionId}'`);
    return tempFiles;
  }

  /**
   * Log a tool execution
   */
  async logToolExecution(sessionId: string, log: ToolLog): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    const toolLogs = [...session.toolLogs, log];

    await this.pool.query(`UPDATE flow_sessions SET tool_logs = $2 WHERE id = $1`, [
      sessionId,
      JSON.stringify(toolLogs),
    ]);

    // Emit event
    const durationMs = log.endedAt.getTime() - log.startedAt.getTime();
    this.app.infra.bus.emit('flowSession:toolExecuted', {
      sessionId,
      log,
      durationMs,
      allLogs: toolLogs,
    });

    console.log(`[SessionDataRepository] Logged tool '${log.name}' execution for session '${sessionId}'`);
  }

  /**
   * Log a skill execution
   */
  async logSkillExecution(sessionId: string, log: SkillLog): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    const skillLogs = [...session.skillLogs, log];

    await this.pool.query(`UPDATE flow_sessions SET skill_logs = $2 WHERE id = $1`, [
      sessionId,
      JSON.stringify(skillLogs),
    ]);

    // Emit event
    const durationMs = log.endedAt.getTime() - log.startedAt.getTime();
    this.app.infra.bus.emit('flowSession:skillExecuted', {
      sessionId,
      log,
      durationMs,
      allLogs: skillLogs,
    });

    console.log(`[SessionDataRepository] Logged skill '${log.name}' execution for session '${sessionId}'`);
  }

  // ==================== Tree Operations ====================

  /**
   * Get all child sessions of a parent session
   */
  async getChildren(parentSessionId: string): Promise<SessionData[]> {
    const result = await this.pool.query(
      'SELECT * FROM flow_sessions WHERE parent_session_id = $1 ORDER BY started_at ASC',
      [parentSessionId],
    );

    return result.rows.map((row) => this.mapDbRowToSession(row));
  }

  /**
   * Get child session tree nodes (lightweight)
   */
  async getChildrenTreeNodes(parentSessionId: string): Promise<SessionDataTreeNode[]> {
    const result = await this.pool.query(
      `SELECT
        fs.id, fs.user_id, fs.flow_name, fs.status, fs.parent_session_id, fs.started_at,
        (SELECT COUNT(*) FROM flow_sessions WHERE parent_session_id = fs.id) as child_count
      FROM flow_sessions fs
      WHERE fs.parent_session_id = $1
      ORDER BY fs.started_at ASC`,
      [parentSessionId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      flowName: row.flow_name,
      status: row.status,
      parentSessionId: row.parent_session_id,
      createdAt: row.started_at, // Using started_at as createdAt for tree nodes
      childCount: parseInt(row.child_count),
    }));
  }

  /**
   * Get the parent session
   */
  async getParent(sessionId: string): Promise<SessionData | null> {
    const session = await this.getSession(sessionId);
    if (!session || !session.parentSessionId) {
      return null;
    }

    return this.getSession(session.parentSessionId);
  }

  /**
   * Get all root sessions (sessions without parents) for a user
   */
  async getRootSessions(userId: string): Promise<SessionData[]> {
    const result = await this.pool.query(
      `SELECT * FROM flow_sessions
       WHERE user_id = $1 AND parent_session_id IS NULL
       ORDER BY started_at DESC`,
      [userId],
    );

    return result.rows.map((row) => this.mapDbRowToSession(row));
  }

  /**
   * Get the full path from root to the given session (ancestors)
   */
  async getSessionPath(sessionId: string): Promise<SessionData[]> {
    const path: SessionData[] = [];
    let currentId: string | undefined = sessionId;

    while (currentId) {
      const session = await this.getSession(currentId);
      if (!session) break;

      path.unshift(session); // Add to beginning of array
      currentId = session.parentSessionId;
    }

    return path;
  }

  /**
   * Get the entire subtree (all descendants) of a session
   */
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

  /**
   * Get session tree statistics
   */
  async getTreeStats(sessionId: string): Promise<{
    depth: number;
    descendantCount: number;
    childCount: number;
  }> {
    const path = await this.getSessionPath(sessionId);
    const children = await this.getChildren(sessionId);
    const subtree = await this.getSubtree(sessionId);

    return {
      depth: path.length - 1, // Depth is number of ancestors
      childCount: children.length,
      descendantCount: subtree.length - 1, // Exclude the session itself
    };
  }

  /**
   * Delete a session and optionally its descendants
   */
  async deleteSession(sessionId: string, deleteDescendants: boolean = false): Promise<boolean> {
    if (deleteDescendants) {
      // Delete entire subtree
      const subtree = await this.getSubtree(sessionId);
      const ids = subtree.map((s) => s.id);

      if (ids.length > 0) {
        await this.pool.query(`DELETE FROM flow_sessions WHERE id = ANY($1)`, [ids]);

        // Emit event
        this.app.infra.bus.emit('flowSession:deleted', {
          sessionId,
          ids,
          deletedCount: ids.length,
          withDescendants: true,
        });

        console.log(`[SessionDataRepository] Deleted session '${sessionId}' and ${ids.length - 1} descendants`);
      }
    } else {
      // Just delete this session, children will have parent_session_id set to NULL due to ON DELETE SET NULL
      const result = await this.pool.query('DELETE FROM flow_sessions WHERE id = $1 RETURNING id', [sessionId]);

      if (result.rowCount === 0) {
        console.log(`[SessionDataRepository] Session '${sessionId}' not found`);
        return false;
      }

      // Emit event
      this.app.infra.bus.emit('flowSession:deleted', {
        sessionId,
        deletedCount: 1,
        withDescendants: false,
      });

      console.log(`[SessionDataRepository] Deleted session '${sessionId}'`);
    }

    return true;
  }
}
