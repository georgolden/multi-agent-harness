/**
 * UserRepository service for managing users and their preferences.
 * Uses Postgres for persistence.
 */
import type { Pool } from 'pg';
import type { User } from './types.js';
import { App } from '../../app.js';

/**
 * UserRepository for managing users and their preferences
 */
export class UserRepository {
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
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255),
        timezone VARCHAR(50) NOT NULL DEFAULT 'UTC'
      )
    `);

    console.log('[UserRepository] Initialized with Postgres');
  }

  /**
   * Cleanup (pool is managed by infra layer)
   */
  async stop(): Promise<void> {
    console.log('[UserRepository] Stopped');
  }

  /**
   * Map database row (snake_case) to User type (camelCase)
   */
  private mapDbRowToUser(row: any): User {
    return {
      id: row.id,
      name: row.name,
      timezone: row.timezone,
    };
  }

  /**
   * Get a user by ID
   */
  async getUser(userId: string): Promise<User | null> {
    const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    return result.rows[0] ? this.mapDbRowToUser(result.rows[0]) : null;
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
    console.log(`[UserRepository] Set timezone for user ${userId}: ${timezone}`);
  }

  /**
   * Create or update a user
   */
  async saveUser(params: { userId: string; name?: string; timezone?: string }): Promise<User> {
    const result = await this.pool.query(
      `INSERT INTO users (id, name, timezone)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
       SET name = COALESCE($2, users.name),
           timezone = COALESCE($3, users.timezone)
       RETURNING *`,
      [params.userId, params.name, params.timezone || 'UTC'],
    );

    const user = this.mapDbRowToUser(result.rows[0]);
    console.log(`[UserRepository] Saved user '${params.userId}'`);
    return user;
  }

  /**
   * Get all users
   */
  async getAllUsers(): Promise<User[]> {
    const result = await this.pool.query('SELECT * FROM users ORDER BY id');
    return result.rows.map((row) => this.mapDbRowToUser(row));
  }

  /**
   * Delete a user
   */
  async deleteUser(userId: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);

    if (result.rowCount === 0) {
      console.log(`[UserRepository] User '${userId}' not found`);
      return false;
    }

    console.log(`[UserRepository] Deleted user '${userId}'`);
    return true;
  }
}
