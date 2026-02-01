/**
 * Storage service for reminders and user preferences.
 * Uses Postgres for persistence.
 */
import { Pool } from 'pg'
import { randomBytes } from 'crypto'
import type { Reminder, User } from '../types'

// Database connection pool
let pool: Pool | null = null

/**
 * Initialize the database connection pool
 */
export async function initStorage(connectionString: string): Promise<void> {
  pool = new Pool({ connectionString })

  // Create tables if they don't exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reminders (
      id VARCHAR(16) PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      chat_id VARCHAR(255) NOT NULL,
      text TEXT NOT NULL,
      schedule_type VARCHAR(10) NOT NULL CHECK (schedule_type IN ('once', 'cron')),
      schedule_value TEXT NOT NULL,
      timezone VARCHAR(50) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      active BOOLEAN NOT NULL DEFAULT TRUE
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      timezone VARCHAR(50) NOT NULL DEFAULT 'UTC'
    )
  `)

  // Create indexes for common queries
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_reminders_user_active
    ON reminders(user_id, active)
  `)

  console.log('[Storage] Initialized with Postgres')
}

/**
 * Close the database connection pool
 */
export async function closeStorage(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
    console.log('[Storage] Connection closed')
  }
}

/**
 * Get the database pool (throws if not initialized)
 */
function getPool(): Pool {
  if (!pool) {
    throw new Error('Storage not initialized. Call initStorage() first.')
  }
  return pool
}

/**
 * Generate a unique reminder ID
 */
export function generateReminderId(): string {
  return randomBytes(4).toString('hex')
}

/**
 * Save a new reminder to the database
 */
export async function saveReminder(params: {
  userId: string
  chatId: string
  text: string
  scheduleType: 'once' | 'cron'
  scheduleValue: string
  timezone: string
  reminderId?: string
}): Promise<Reminder> {
  const db = getPool()
  const id = params.reminderId || generateReminderId()

  const result = await db.query<Reminder>(
    `INSERT INTO reminders (id, user_id, chat_id, text, schedule_type, schedule_value, timezone)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      id,
      params.userId,
      params.chatId,
      params.text,
      params.scheduleType,
      params.scheduleValue,
      params.timezone,
    ],
  )

  const reminder = result.rows[0]
  console.log(`[Storage] Saved reminder '${id}': ${params.text.slice(0, 50)}...`)
  return reminder
}

/**
 * Get all active reminders for a specific user
 */
export async function getReminders(userId: string): Promise<Reminder[]> {
  const db = getPool()
  const result = await db.query<Reminder>(
    `SELECT * FROM reminders
     WHERE user_id = $1 AND active = TRUE
     ORDER BY created_at DESC`,
    [userId],
  )
  return result.rows
}

/**
 * Get a specific reminder by ID
 */
export async function getReminder(reminderId: string): Promise<Reminder | null> {
  const db = getPool()
  const result = await db.query<Reminder>('SELECT * FROM reminders WHERE id = $1', [reminderId])
  return result.rows[0] || null
}

/**
 * Get a reminder by ID, scoped to a specific user
 */
export async function getReminderForUser(
  reminderId: string,
  userId: string,
): Promise<Reminder | null> {
  const db = getPool()
  const result = await db.query<Reminder>(
    `SELECT * FROM reminders
     WHERE id = $1 AND user_id = $2 AND active = TRUE`,
    [reminderId, userId],
  )
  return result.rows[0] || null
}

/**
 * Get all active reminders (for scheduler restore on startup)
 */
export async function getAllReminders(): Promise<Reminder[]> {
  const db = getPool()
  const result = await db.query<Reminder>('SELECT * FROM reminders WHERE active = TRUE')
  return result.rows
}

/**
 * Soft delete a reminder (mark as inactive)
 */
export async function deleteReminder(reminderId: string): Promise<boolean> {
  const db = getPool()
  const result = await db.query(
    'UPDATE reminders SET active = FALSE WHERE id = $1 RETURNING id',
    [reminderId],
  )

  if (result.rowCount === 0) {
    console.log(`[Storage] Reminder '${reminderId}' not found`)
    return false
  }

  console.log(`[Storage] Deleted reminder '${reminderId}'`)
  return true
}

/**
 * Get user's preferred timezone (creates user if not exists)
 */
export async function getUserTimezone(userId: string): Promise<string> {
  const db = getPool()
  const result = await db.query<User>('SELECT timezone FROM users WHERE id = $1', [userId])

  if (result.rows.length === 0) {
    // Create user with default timezone
    await db.query('INSERT INTO users (id, timezone) VALUES ($1, $2)', [userId, 'UTC'])
    return 'UTC'
  }

  return result.rows[0].timezone
}

/**
 * Set user's preferred timezone
 */
export async function setUserTimezone(userId: string, timezone: string): Promise<void> {
  const db = getPool()
  await db.query(
    `INSERT INTO users (id, timezone) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET timezone = $2`,
    [userId, timezone],
  )
  console.log(`[Storage] Set timezone for user ${userId}: ${timezone}`)
}
