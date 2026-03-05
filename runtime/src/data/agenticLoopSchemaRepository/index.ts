/**
 * AgenticLoopSchemaRepository service for managing agentic loop schemas.
 * Uses Postgres for persistence.
 */
import type { Pool } from 'pg';
import type { AgenticLoopSchema } from '../../flows/agentictLoop/flow.js';
import type { StoredAgenticLoopSchema, RepositoryHook } from './types.js';
import { App } from '../../app.js';

/**
 * AgenticLoopSchemaRepository for managing agentic loop schemas
 */
export class AgenticLoopSchemaRepository {
  private pool: Pool;
  app: App;
  private hooks: RepositoryHook = {};

  constructor(app: App) {
    this.app = app;
    this.pool = app.infra.pg.pool;
  }

  /**
   * Register repository hooks
   */
  registerHooks(hooks: RepositoryHook): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  /**
   * Initialize database tables and indexes
   */
  async start(): Promise<void> {
    // Create tables if they don't exist
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agentic_loop_schemas (
        flow_name VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255),
        description TEXT NOT NULL,
        user_prompt_template TEXT,
        system_prompt TEXT NOT NULL,
        tool_names TEXT[] NOT NULL,
        skill_names TEXT[] NOT NULL,
        context_paths JSONB NOT NULL,
        call_llm_options JSONB NOT NULL,
        message_window_config JSONB NOT NULL,
        agent_loop_config JSONB NOT NULL
      )
    `);

    // Create indexes for common queries
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_agentic_loop_schemas_user
      ON agentic_loop_schemas(user_id)
    `);

    console.log('[AgenticLoopSchemaRepository] Initialized with Postgres');
  }

  /**
   * Cleanup (pool is managed by infra layer)
   */
  async stop(): Promise<void> {
    console.log('[AgenticLoopSchemaRepository] Stopped');
  }

  /**
   * Map database row (snake_case) to StoredAgenticLoopSchema type (camelCase)
   */
  private mapDbRowToSchema(row: any): StoredAgenticLoopSchema {
    return {
      userId: row.user_id,
      flowName: row.flow_name,
      description: row.description,
      userPromptTemplate: row.user_prompt_template,
      systemPrompt: row.system_prompt,
      toolNames: row.tool_names,
      skillNames: row.skill_names,
      contextPaths: row.context_paths,
      callLlmOptions: row.call_llm_options,
      messageWindowConfig: row.message_window_config,
      agentLoopConfig: row.agent_loop_config,
    };
  }

  /**
   * Save a new agentic loop schema to the database
   */
  async createSchema(params: { userId?: string; schema: AgenticLoopSchema }): Promise<StoredAgenticLoopSchema> {
    const result = await this.pool.query(
      `INSERT INTO agentic_loop_schemas (
        flow_name, user_id, description, user_prompt_template, system_prompt,
        tool_names, skill_names, context_paths, call_llm_options,
        message_window_config, agent_loop_config
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        params.schema.flowName,
        params.userId || null,
        params.schema.description,
        params.schema.userPromptTemplate || null,
        params.schema.systemPrompt,
        params.schema.toolNames,
        params.schema.skillNames,
        JSON.stringify(params.schema.contextPaths),
        JSON.stringify(params.schema.callLlmOptions),
        JSON.stringify(params.schema.messageWindowConfig),
        JSON.stringify(params.schema.agentLoopConfig),
      ],
    );

    const schema = this.mapDbRowToSchema(result.rows[0]);
    console.log(`[AgenticLoopSchemaRepository] Created schema '${params.schema.flowName}'`);

    // Trigger onInsert hook
    if (this.hooks.onInsert) {
      await this.hooks.onInsert(schema);
    }

    return schema;
  }

  /**
   * Get a schema by flowName
   */
  async getSchema(flowName: string): Promise<StoredAgenticLoopSchema | null> {
    const result = await this.pool.query('SELECT * FROM agentic_loop_schemas WHERE flow_name = $1', [flowName]);
    return result.rows[0] ? this.mapDbRowToSchema(result.rows[0]) : null;
  }

  /**
   * Get a schema by flowName, scoped to a specific user
   */
  async getSchemaForUser(flowName: string, userId: string): Promise<StoredAgenticLoopSchema | null> {
    const result = await this.pool.query(
      `SELECT * FROM agentic_loop_schemas
       WHERE flow_name = $1 AND user_id = $2`,
      [flowName, userId],
    );
    return result.rows[0] ? this.mapDbRowToSchema(result.rows[0]) : null;
  }

  /**
   * Get all schemas for a specific user
   */
  async getAllSchemasForUser(userId: string): Promise<StoredAgenticLoopSchema[]> {
    const result = await this.pool.query(
      `SELECT * FROM agentic_loop_schemas
       WHERE user_id = $1
       ORDER BY flow_name`,
      [userId],
    );
    return result.rows.map((row) => this.mapDbRowToSchema(row));
  }

  /**
   * Get all schemas
   */
  async getAllSchemas(): Promise<StoredAgenticLoopSchema[]> {
    const result = await this.pool.query('SELECT * FROM agentic_loop_schemas ORDER BY flow_name');
    return result.rows.map((row) => this.mapDbRowToSchema(row));
  }

  /**
   * Update a schema
   */
  async updateSchema(flowName: string, params: Partial<AgenticLoopSchema>): Promise<StoredAgenticLoopSchema | null> {
    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(params.description);
    }

    if (params.userPromptTemplate !== undefined) {
      updates.push(`user_prompt_template = $${paramIndex++}`);
      values.push(params.userPromptTemplate || null);
    }

    if (params.systemPrompt !== undefined) {
      updates.push(`system_prompt = $${paramIndex++}`);
      values.push(params.systemPrompt);
    }

    if (params.toolNames !== undefined) {
      updates.push(`tool_names = $${paramIndex++}`);
      values.push(params.toolNames);
    }

    if (params.skillNames !== undefined) {
      updates.push(`skill_names = $${paramIndex++}`);
      values.push(params.skillNames);
    }

    if (params.contextPaths !== undefined) {
      updates.push(`context_paths = $${paramIndex++}`);
      values.push(JSON.stringify(params.contextPaths));
    }

    if (params.callLlmOptions !== undefined) {
      updates.push(`call_llm_options = $${paramIndex++}`);
      values.push(JSON.stringify(params.callLlmOptions));
    }

    if (params.messageWindowConfig !== undefined) {
      updates.push(`message_window_config = $${paramIndex++}`);
      values.push(JSON.stringify(params.messageWindowConfig));
    }

    if (params.agentLoopConfig !== undefined) {
      updates.push(`agent_loop_config = $${paramIndex++}`);
      values.push(JSON.stringify(params.agentLoopConfig));
    }

    if (updates.length === 0) {
      return this.getSchema(flowName);
    }

    values.push(flowName);

    const query = `UPDATE agentic_loop_schemas
                   SET ${updates.join(', ')}
                   WHERE flow_name = $${paramIndex}
                   RETURNING *`;

    const result = await this.pool.query(query, values);

    if (result.rowCount === 0) {
      console.log(`[AgenticLoopSchemaRepository] Schema '${flowName}' not found`);
      return null;
    }

    const schema = this.mapDbRowToSchema(result.rows[0]);
    console.log(`[AgenticLoopSchemaRepository] Updated schema '${flowName}'`);

    // Trigger onUpdate hook
    if (this.hooks.onUpdate) {
      await this.hooks.onUpdate(schema);
    }

    return schema;
  }

  /**
   * Delete a schema
   */
  async deleteSchema(flowName: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM agentic_loop_schemas WHERE flow_name = $1 RETURNING flow_name', [
      flowName,
    ]);

    if (result.rowCount === 0) {
      console.log(`[AgenticLoopSchemaRepository] Schema '${flowName}' not found`);
      return false;
    }

    console.log(`[AgenticLoopSchemaRepository] Deleted schema '${flowName}'`);

    // Trigger onDelete hook
    if (this.hooks.onDelete) {
      await this.hooks.onDelete(flowName);
    }

    return true;
  }

  /**
   * Delete a schema, scoped to a specific user
   */
  async deleteSchemaForUser(flowName: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM agentic_loop_schemas WHERE flow_name = $1 AND user_id = $2 RETURNING flow_name',
      [flowName, userId],
    );

    if (result.rowCount === 0) {
      console.log(`[AgenticLoopSchemaRepository] Schema '${flowName}' not found for user ${userId}`);
      return false;
    }

    console.log(`[AgenticLoopSchemaRepository] Deleted schema '${flowName}' for user ${userId}`);

    // Trigger onDelete hook
    if (this.hooks.onDelete) {
      await this.hooks.onDelete(flowName);
    }

    return true;
  }
}
