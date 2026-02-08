/**
 * Scheduler service using Agenda with Postgres backend.
 * Handles one-time and recurring reminder jobs.
 */
import { Agenda } from 'agenda';
import type { Job } from 'agenda';
import type { Reminder } from '../../data/reminderRepository/types.js';
import type { App } from '../../app.js';
export declare class Scheduler {
    private agenda;
    app: App;
    constructor(app: App, { connectionString }: {
        connectionString: string;
    });
    /**
     * Start the scheduler
     */
    start(): Promise<void>;
    /**
     * Stop the scheduler gracefully
     */
    stop(): Promise<void>;
    /**
     * Schedule a one-time reminder
     */
    scheduleOnce(params: {
        jobId: string;
        runDate: string;
        callback: (job: Job) => Promise<void>;
        callbackData: Record<string, unknown>;
    }): Promise<void>;
    /**
     * Schedule a recurring reminder using cron expression
     */
    scheduleCron(params: {
        jobId: string;
        cronExpression: string;
        callback: (job: Job) => Promise<void>;
        startDate?: string;
        endDate?: string;
        timezone?: string;
        callbackData: Record<string, unknown>;
    }): Promise<void>;
    /**
     * Callback function that executes when a reminder fires
     */
    private onReminderFire;
    /**
     * Schedule a reminder from a Reminder object
     */
    scheduleReminder(reminder: Reminder): Promise<void>;
    /**
     * Remove a scheduled job by ID
     */
    removeJob(jobId: string): Promise<boolean>;
    /**
     * Get the Agenda instance for advanced operations
     */
    getAgenda(): Agenda;
}
export declare const config: {
    connectionString: string;
};
