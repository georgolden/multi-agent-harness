/**
 * FlowRunRepository — persists flow execution records.
 *
 * Each flow_runs row links a flow execution to its session and user,
 * tracks lifecycle status, and records timing metadata.
 */
import type { Pool } from 'pg';
import type { App } from '../../app.js';
import type { FlowRunRecord, FlowRunStatus } from '../../flows/types.js';
import { randomBytes } from 'node:crypto';

function generateRunId(): string {
  return randomBytes(4).toString('hex');
}

function mapRow(row: Record<string, any>): FlowRunRecord {
  return {
    id: row.id,
    flowName: row.flow_name,
    sessionId: row.session_id,
    userId: row.user_id,
    status: row.status as FlowRunStatus,
    startedAt: new Date(row.started_at),
    endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
    parentSessionId: row.parent_session_id ?? undefined,
  };
}

export class FlowRunRepository {
  private pool: Pool;

  constructor(app: App) {
    this.pool = app.infra.pg.pool;
  }

  async start(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS flow_runs (
        id VARCHAR(32) PRIMARY KEY,
        flow_name VARCHAR(255) NOT NULL,
        session_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'running',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        parent_session_id VARCHAR(255)
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS flow_runs_user_id_idx ON flow_runs (user_id)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS flow_runs_session_id_idx ON flow_runs (session_id)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS flow_runs_status_idx ON flow_runs (status)
    `);
    console.log('[FlowRunRepository] Table ready');
  }

  async stop(): Promise<void> {}

  async createRun(params: {
    flowName: string;
    sessionId: string;
    userId: string;
    parentSessionId?: string;
  }): Promise<FlowRunRecord> {
    const id = generateRunId();
    const result = await this.pool.query(
      `INSERT INTO flow_runs (id, flow_name, session_id, user_id, status, parent_session_id)
       VALUES ($1, $2, $3, $4, 'running', $5)
       RETURNING *`,
      [id, params.flowName, params.sessionId, params.userId, params.parentSessionId ?? null],
    );
    return mapRow(result.rows[0]);
  }

  async updateStatus(id: string, status: FlowRunStatus): Promise<void> {
    const endedAt = status === 'completed' || status === 'failed' ? new Date() : null;
    await this.pool.query(
      `UPDATE flow_runs SET status = $1, ended_at = COALESCE($2, ended_at) WHERE id = $3`,
      [status, endedAt, id],
    );
  }

  async getActiveRuns(): Promise<FlowRunRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM flow_runs WHERE status IN ('running', 'paused') ORDER BY started_at DESC`,
    );
    return result.rows.map(mapRow);
  }

  async getRunsByUser(userId: string): Promise<FlowRunRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM flow_runs WHERE user_id = $1 ORDER BY started_at DESC`,
      [userId],
    );
    return result.rows.map(mapRow);
  }

  async getRunBySessionId(sessionId: string): Promise<FlowRunRecord | null> {
    const result = await this.pool.query(`SELECT * FROM flow_runs WHERE session_id = $1 LIMIT 1`, [sessionId]);
    return result.rows.length ? mapRow(result.rows[0]) : null;
  }
}
