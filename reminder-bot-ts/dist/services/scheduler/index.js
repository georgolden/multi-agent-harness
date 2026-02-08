/**
 * Scheduler service using Agenda with Postgres backend.
 * Handles one-time and recurring reminder jobs.
 */
import { Agenda } from 'agenda';
import { PostgresBackend } from '@agendajs/postgres-backend';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
dayjs.extend(utc);
export class Scheduler {
    agenda;
    app;
    constructor(app, { connectionString }) {
        const backend = new PostgresBackend({
            connectionString,
        });
        this.app = app;
        this.agenda = new Agenda({
            backend,
            processEvery: '30 seconds',
            maxConcurrency: 20,
        });
        console.log('[Scheduler] Initialized with Postgres backend');
    }
    /**
     * Start the scheduler
     */
    async start() {
        console.log('[Scheduler.start] Starting Agenda scheduler...');
        await this.restoreJobs();
        await this.agenda.start();
        console.log('[Scheduler] Started successfully');
    }
    /**
     * Stop the scheduler gracefully
     */
    async stop() {
        await this.agenda.stop();
        console.log('[Scheduler] Stopped');
    }
    /**
     * Schedule a one-time reminder
     */
    async scheduleOnce(params) {
        // Parse the run date (always UTC)
        const parsedDate = dayjs.utc(params.runDate).toDate();
        // Define the job type with the callback
        this.agenda.define(params.jobId, params.callback);
        // Schedule the job
        await this.agenda.schedule(parsedDate, params.jobId, params.callbackData);
        console.log(`[Scheduler] Scheduled one-time job '${params.jobId}' for ${parsedDate.toISOString()} UTC`);
    }
    /**
     * Schedule a recurring reminder using cron expression
     */
    async scheduleCron(params) {
        // Convert 5-field cron to 6-field cron (Agenda uses 6 fields)
        // 5-field: minute hour day month weekday
        // 6-field: second minute hour day month weekday
        const cronParts = params.cronExpression.trim().split(/\s+/);
        if (cronParts.length !== 5) {
            throw new Error(`Invalid cron expression: expected 5 fields, got ${cronParts.length}`);
        }
        const agendaCron = `0 ${params.cronExpression}`; // Add "0" for seconds
        // Define the job type
        this.agenda.define(params.jobId, params.callback);
        // Schedule the job
        const job = this.agenda.create(params.jobId, params.callbackData);
        const timezone = params.timezone || 'UTC';
        job.repeatEvery(agendaCron, {
            timezone,
            skipImmediate: true,
        });
        // Set start date if provided
        if (params.startDate) {
            const parsedStartDate = dayjs.utc(params.startDate).toDate();
            job.startDate(parsedStartDate);
        }
        // Set end date if provided
        if (params.endDate) {
            const parsedEndDate = dayjs.utc(params.endDate).toDate();
            job.endDate(parsedEndDate);
        }
        await job.save();
        const endInfo = params.endDate ? ` (ends: ${params.endDate})` : '';
        console.log(`[Scheduler] Scheduled cron job '${params.jobId}' with expression '${params.cronExpression}' in timezone ${timezone}${endInfo}`);
    }
    /**
     * Callback function that executes when a reminder fires
     */
    async onReminderFire(job) {
        const { chatId, text, reminderId, scheduleType } = job.attrs.data;
        console.log(`[ReminderFire] Sending reminder ${reminderId} to chat ${chatId}`);
        try {
            this.app.infra.bus.emit('telegram.sendMessage', { chatId, message: `⏰ Reminder: ${text}` });
            // For one-time reminders, mark as inactive after firing
            if (scheduleType === 'once') {
                await this.app.data.reminderRepository.deleteReminder(reminderId);
            }
        }
        catch (error) {
            console.error(`[ReminderFire] Error sending reminder ${reminderId}:`, error);
        }
    }
    /**
     * Schedule a reminder from a Reminder object
     */
    async scheduleReminder(reminder) {
        const callbackData = {
            chatId: reminder.chatId,
            text: reminder.text,
            reminderId: reminder.id,
            scheduleType: reminder.scheduleType,
        };
        const callback = (job) => this.onReminderFire(job);
        try {
            if (reminder.scheduleType === 'once') {
                await this.scheduleOnce({
                    jobId: reminder.id,
                    runDate: reminder.scheduleValue,
                    callback,
                    callbackData,
                });
            }
            else if (reminder.scheduleType === 'cron') {
                await this.scheduleCron({
                    jobId: reminder.id,
                    cronExpression: reminder.scheduleValue,
                    callback,
                    startDate: reminder.startDate ? reminder.startDate.toISOString() : undefined,
                    endDate: reminder.endDate ? reminder.endDate.toISOString() : undefined,
                    timezone: reminder.timezone,
                    callbackData,
                });
            }
            else {
                console.error(`[Scheduler.scheduleReminder] Unknown schedule type: ${reminder.scheduleType}`);
                throw new Error(`Unknown schedule type: ${reminder.scheduleType}`);
            }
        }
        catch (error) {
            console.error(`[Scheduler.scheduleReminder] Error:`, error);
            throw error;
        }
    }
    /**
     * Restore job definitions for existing reminders.
     * This is necessary because Agenda requires job definitions to be loaded in memory
     * to process jobs stored in the database.
     */
    async restoreJobs() {
        console.log('[Scheduler.restoreJobs] Restoring job definitions...');
        const reminders = await this.app.data.reminderRepository.getAllReminders();
        if (reminders.length === 0) {
            console.log('[Scheduler.restoreJobs] No reminders to restore');
            return;
        }
        for (const reminder of reminders) {
            // We only define the job processor.
            // We do NOT call schedule() or create() because the job data is already in the Agenda DB.
            this.agenda.define(reminder.id, (job) => this.onReminderFire(job));
        }
        console.log(`[Scheduler.restoreJobs] Restored definitions for ${reminders.length} reminders`);
    }
    /**
     * Remove a scheduled job by ID
     */
    async removeJob(jobId) {
        try {
            // Use cancel to remove jobs matching the name
            const removed = await this.agenda.cancel({ name: jobId });
            if (removed > 0) {
                console.log(`[Scheduler] Removed job '${jobId}'`);
                return true;
            }
            else {
                return false;
            }
        }
        catch (error) {
            console.error(`[Scheduler.removeJob] Error removing job '${jobId}':`, error);
            return false;
        }
    }
    /**
     * Get the Agenda instance for advanced operations
     */
    getAgenda() {
        return this.agenda;
    }
}
if (!process.env.DATABASE_URL) {
    throw new Error('Env DATABASE_URL is not defined');
}
export const config = {
    connectionString: process.env.DATABASE_URL,
};
