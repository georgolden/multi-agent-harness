/**
 * ReminderRepository service for reminders and user preferences.
 * Uses Postgres for persistence.
 */
import { Pool } from 'pg';
import { randomBytes } from 'crypto';
import type { Reminder, User } from './types.js';
import { App } from '../../app.js';

/**
 * ReminderRepository for managing reminders and user preferences
 */
export class ReminderRepository {
  public pool: Pool;
  app: App;

  constructor(app: App, { connectionString }: { connectionString: string }) {
    this.app = app;
    this.pool = new Pool({ connectionString });
  }

  /**
   * Initialize database tables and indexes
   */
  async start(): Promise<void> {
    // Create tables if they don't exist
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS reminders (
        id VARCHAR(16) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        chat_id VARCHAR(255) NOT NULL,
        text TEXT NOT NULL,
        schedule_type VARCHAR(10) NOT NULL CHECK (schedule_type IN ('once', 'cron')),
        schedule_value TEXT NOT NULL,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        timezone VARCHAR(50) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        active BOOLEAN NOT NULL DEFAULT TRUE
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        timezone VARCHAR(50) NOT NULL DEFAULT 'UTC'
      )
    `);

    // Create indexes for common queries
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_reminders_user_active
      ON reminders(user_id, active)
    `);

    console.log('[ReminderRepository] Initialized with Postgres');
  }

  /**
   * Close the database connection pool
   */
  async stop(): Promise<void> {
    await this.pool.end();
    console.log('[ReminderRepository] Connection closed');
  }

  /**
   * Generate a unique reminder ID
   */
  generateReminderId(): string {
    return randomBytes(4).toString('hex');
  }

  /**
   * Map database row (snake_case) to Reminder type (camelCase)
   */
  private mapDbRowToReminder(row: any): Reminder {
    return {
      id: row.id,
      userId: row.user_id,
      chatId: row.chat_id,
      text: row.text,
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
   * Save a new reminder to the database
   */
  async saveReminder(params: {
    userId: string;
    chatId: string;
    text: string;
    scheduleType: 'once' | 'cron';
    scheduleValue: string;
    startDate?: Date;
    endDate?: Date;
    timezone: string;
    reminderId?: string;
  }): Promise<Reminder> {
    const id = params.reminderId || this.generateReminderId();

    const result = await this.pool.query(
      `INSERT INTO reminders (id, user_id, chat_id, text, schedule_type, schedule_value, start_date, end_date, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id,
        params.userId,
        params.chatId,
        params.text,
        params.scheduleType,
        params.scheduleValue,
        params.startDate,
        params.endDate,
        params.timezone,
      ],
    );

    const reminder = this.mapDbRowToReminder(result.rows[0]);
    console.log(`[ReminderRepository] Saved reminder '${id}': ${params.text.slice(0, 50)}...`);
    return reminder;
  }

  /**
   * Get all active reminders for a specific user
   */
  async getReminders(userId: string): Promise<Reminder[]> {
    const result = await this.pool.query(
      `SELECT * FROM reminders
       WHERE user_id = $1 AND active = TRUE
       ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows.map((row) => this.mapDbRowToReminder(row));
  }

  /**
   * Get a specific reminder by ID
   */
  async getReminder(reminderId: string): Promise<Reminder | null> {
    const result = await this.pool.query('SELECT * FROM reminders WHERE id = $1', [reminderId]);
    return result.rows[0] ? this.mapDbRowToReminder(result.rows[0]) : null;
  }

  /**
   * Get a reminder by ID, scoped to a specific user
   */
  async getReminderForUser(reminderId: string, userId: string): Promise<Reminder | null> {
    const result = await this.pool.query(
      `SELECT * FROM reminders
       WHERE id = $1 AND user_id = $2 AND active = TRUE`,
      [reminderId, userId],
    );
    return result.rows[0] ? this.mapDbRowToReminder(result.rows[0]) : null;
  }

  /**
   * Get all active reminders (for scheduler restore on startup)
   */
  async getAllReminders(): Promise<Reminder[]> {
    const result = await this.pool.query('SELECT * FROM reminders WHERE active = TRUE');
    return result.rows.map((row) => this.mapDbRowToReminder(row));
  }

  /**
   * Soft delete a reminder (mark as inactive)
   */
  async deleteReminder(reminderId: string): Promise<boolean> {
    const result = await this.pool.query('UPDATE reminders SET active = FALSE WHERE id = $1 RETURNING id', [
      reminderId,
    ]);

    if (result.rowCount === 0) {
      console.log(`[ReminderRepository] Reminder '${reminderId}' not found`);
      return false;
    }

    console.log(`[ReminderRepository] Deleted reminder '${reminderId}'`);
    return true;
  }

  /**
   * Check if a user exists in the database (without creating one)
   */
  async hasUser(userId: string): Promise<boolean> {
    const result = await this.pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    return result.rows.length > 0;
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
    console.log(`[ReminderRepository] Set timezone for user ${userId}: ${timezone}`);
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error('Env DATABASE_URL is not defined');
}

export const config = {
  connectionString: process.env.DATABASE_URL,
};
