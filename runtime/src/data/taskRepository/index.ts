/**
 * TaskRepository service for scheduled tasks.
 * Uses Postgres for persistence.
 */
import type { Pool } from 'pg';
import { randomBytes } from 'crypto';
import type { Task } from './types.js';
import { App } from '../../app.js';
import type { User } from '../userRepository/types.js';

/**
 * TaskRepository for managing scheduled tasks
 */
export class TaskRepository {
  private pool: Pool;
  app: App;

  constructor(app: App) {
    this.app = app;
    this.pool = app.infra.pg.pool;
  }

  /**
   * Initialize database tables and indexes
   */
  async start(): Promise<void> {
    // Create tables if they don't exist
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id VARCHAR(16) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        chat_id VARCHAR(255) NOT NULL,
        task_name TEXT NOT NULL,
        parameters JSONB NOT NULL,
        schedule_type VARCHAR(10) NOT NULL CHECK (schedule_type IN ('once', 'cron')),
        schedule_value TEXT NOT NULL,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        timezone VARCHAR(50) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        active BOOLEAN NOT NULL DEFAULT TRUE
      )
    `);

    // Create indexes for common queries
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_user_active
      ON tasks(user_id, active)
    `);

    console.log('[TaskRepository] Initialized with Postgres');
  }

  /**
   * Cleanup (pool is managed by infra layer)
   */
  async stop(): Promise<void> {
    console.log('[TaskRepository] Stopped');
  }

  /**
   * Generate a unique task ID
   */
  generateTaskId(): string {
    return randomBytes(4).toString('hex');
  }

  /**
   * Map database row (snake_case) to Task type (camelCase)
   */
  private mapDbRowToTask(row: any): Task {
    return {
      id: row.id,
      userId: row.user_id,
      taskName: row.task_name,
      parameters: row.parameters,
      scheduleType: row.schedule_type,
      scheduleValue: row.schedule_value,
      startDate: row.start_date,
      endDate: row.end_date,
      timezone: row.timezone,
      createdAt: row.created_at,
      active: row.active,
    };
  }

  /**
   * Save a new task to the database
   */
  async saveTask(params: {
    userId: string;
    taskName: string;
    parameters: Record<string, any>;
    scheduleType: 'once' | 'cron';
    scheduleValue: string;
    startDate?: Date;
    endDate?: Date;
    timezone: string;
    taskId?: string;
  }): Promise<Task> {
    const id = params.taskId || this.generateTaskId();

    const result = await this.pool.query(
      `INSERT INTO tasks (id, user_id, task_name, parameters, schedule_type, schedule_value, start_date, end_date, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id,
        params.userId,
        params.taskName,
        JSON.stringify(params.parameters),
        params.scheduleType,
        params.scheduleValue,
        params.startDate,
        params.endDate,
        params.timezone,
      ],
    );

    const task = this.mapDbRowToTask(result.rows[0]);
    console.log(`[TaskRepository] Saved task '${id}': ${params.taskName}`);
    return task;
  }

  /**
   * Get all active tasks for a specific user
   */
  async getTasks(userId: string): Promise<Task[]> {
    const result = await this.pool.query(
      `SELECT * FROM tasks
       WHERE user_id = $1 AND active = TRUE
       ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows.map((row) => this.mapDbRowToTask(row));
  }

  /**
   * Get a specific task by ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    const result = await this.pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    return result.rows[0] ? this.mapDbRowToTask(result.rows[0]) : null;
  }

  /**
   * Get a task by ID, scoped to a specific user
   */
  async getTaskForUser(taskId: string, userId: string): Promise<Task | null> {
    const result = await this.pool.query(
      `SELECT * FROM tasks
       WHERE id = $1 AND user_id = $2 AND active = TRUE`,
      [taskId, userId],
    );
    return result.rows[0] ? this.mapDbRowToTask(result.rows[0]) : null;
  }

  /**
   * Get all active tasks (for scheduler restore on startup)
   */
  async getAllTasks(): Promise<Task[]> {
    const result = await this.pool.query('SELECT * FROM tasks WHERE active = TRUE');
    return result.rows.map((row) => this.mapDbRowToTask(row));
  }

  /**
   * Soft delete a task (mark as inactive)
   */
  async deleteTask(taskId: string): Promise<boolean> {
    const result = await this.pool.query('UPDATE tasks SET active = FALSE WHERE id = $1 RETURNING id', [taskId]);

    if (result.rowCount === 0) {
      console.log(`[TaskRepository] Task '${taskId}' not found`);
      return false;
    }

    console.log(`[TaskRepository] Deleted task '${taskId}'`);
    return true;
  }

  /**
   * Get user's preferred timezone (creates user if not exists)
   */
  async getUserTimezone(userId: string): Promise<string> {
    const result = await this.pool.query<User>('SELECT timezone FROM users WHERE id = $1', [userId]);

    if (result.rows.length === 0) {
      // Create user with default timezone
      await this.pool.query('INSERT INTO users (id, timezone) VALUES ($1, $2)', [userId, 'UTC']);
      return 'UTC';
    }

    return result.rows[0].timezone;
  }

  /**
   * Set user's preferred timezone
   */
  async setUserTimezone(userId: string, timezone: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (id, timezone) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET timezone = $2`,
      [userId, timezone],
    );
    console.log(`[TaskRepository] Set timezone for user ${userId}: ${timezone}`);
  }
}
