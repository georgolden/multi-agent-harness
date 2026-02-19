/**
 * ReminderRepository service for reminders and user preferences.
 * Uses Postgres for persistence.
 */
import { Pool } from 'pg';
import type { Reminder } from './types.js';
import { App } from '../../app.js';
/**
 * ReminderRepository for managing reminders and user preferences
 */
export declare class ReminderRepository {
    pool: Pool;
    app: App;
    constructor(app: App, { connectionString }: {
        connectionString: string;
    });
    /**
     * Initialize database tables and indexes
     */
    start(): Promise<void>;
    /**
     * Close the database connection pool
     */
    stop(): Promise<void>;
    /**
     * Generate a unique reminder ID
     */
    generateReminderId(): string;
    /**
     * Map database row (snake_case) to Reminder type (camelCase)
     */
    private mapDbRowToReminder;
    /**
     * Save a new reminder to the database
     */
    saveReminder(params: {
        userId: string;
        chatId: string;
        text: string;
        scheduleType: 'once' | 'cron';
        scheduleValue: string;
        startDate?: Date;
        endDate?: Date;
        timezone: string;
        reminderId?: string;
    }): Promise<Reminder>;
    /**
     * Get all active reminders for a specific user
     */
    getReminders(userId: string): Promise<Reminder[]>;
    /**
     * Get a specific reminder by ID
     */
    getReminder(reminderId: string): Promise<Reminder | null>;
    /**
     * Get a reminder by ID, scoped to a specific user
     */
    getReminderForUser(reminderId: string, userId: string): Promise<Reminder | null>;
    /**
     * Get all active reminders (for scheduler restore on startup)
     */
    getAllReminders(): Promise<Reminder[]>;
    /**
     * Soft delete a reminder (mark as inactive)
     */
    deleteReminder(reminderId: string): Promise<boolean>;
    /**
     * Check if a user exists in the database (without creating one)
     */
    hasUser(userId: string): Promise<boolean>;
    /**
     * Get user's preferred timezone (creates user if not exists)
     */
    getUserTimezone(userId: string): Promise<string>;
    /**
     * Set user's preferred timezone
     */
    setUserTimezone(userId: string, timezone: string): Promise<void>;
}
export declare const config: {
    connectionString: string;
};
