/**
 * Scheduler service using Agenda with Postgres backend.
 * Handles one-time and recurring reminder jobs.
 */
import { Agenda } from 'agenda';
import type { Job } from 'agenda';
import { PostgresBackend } from '@agendajs/postgres-backend';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { Reminder } from '../types.js';
import { App } from '../app.js';

dayjs.extend(utc);

export class Scheduler {
  private agenda: Agenda;
  app: App;

  constructor(app: App, { connectionString }: { connectionString: string }) {
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
  async start(): Promise<void> {
    await this.agenda.start();
    console.log('[Scheduler] Started');
  }

  /**
   * Stop the scheduler gracefully
   */
  async stop(): Promise<void> {
    await this.agenda.stop();
    console.log('[Scheduler] Stopped');
  }

  /**
   * Schedule a one-time reminder
   */
  async scheduleOnce(params: {
    jobId: string;
    runDate: string;
    callback: (job: Job) => Promise<void>;
    callbackData: Record<string, unknown>;
  }): Promise<void> {
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
  async scheduleCron(params: {
    jobId: string;
    cronExpression: string;
    callback: (job: Job) => Promise<void>;
    startDate?: string;
    endDate?: string;
    callbackData: Record<string, unknown>;
  }): Promise<void> {
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
    job.repeatEvery(agendaCron, {
      timezone: 'UTC',
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
      console.log(`[Scheduler] Setting end date for job '${params.jobId}': ${parsedEndDate}`);
      job.endDate(parsedEndDate);
    }

    await job.save();

    const endInfo = params.endDate ? ` (ends: ${params.endDate})` : '';
    console.log(
      `[Scheduler] Scheduled cron job '${params.jobId}' with expression '${params.cronExpression}' UTC${endInfo}`,
    );
  }

  /**
   * Callback function that executes when a reminder fires
   */
  private async onReminderFire(job: Job): Promise<void> {
    const { chatId, text, reminderId, scheduleType } = job.attrs.data as {
      chatId: string;
      text: string;
      reminderId: string;
      scheduleType: string;
    };
    console.log(`[ReminderFire] Sending reminder ${reminderId} to chat ${chatId}`);

    try {
      await this.app.services.telegram.sendMessage(chatId, `⏰ Reminder: ${text}`);

      // For one-time reminders, mark as inactive after firing
      if (scheduleType === 'once') {
        await this.app.data.storage.deleteReminder(reminderId);
        console.log(`[ReminderFire] Deleted one-time reminder ${reminderId}`);
      }
    } catch (error) {
      console.error(`[ReminderFire] Error sending reminder ${reminderId}:`, error);
    }
  }

  /**
   * Schedule a reminder from a Reminder object
   */
  async scheduleReminder(reminder: Reminder): Promise<void> {
    const callbackData = {
      chatId: reminder.chatId,
      text: reminder.text,
      reminderId: reminder.id,
      scheduleType: reminder.scheduleType,
    };

    const callback = (job: Job) => this.onReminderFire(job);

    if (reminder.scheduleType === 'once') {
      await this.scheduleOnce({
        jobId: reminder.id,
        runDate: reminder.scheduleValue,
        callback,
        callbackData,
      });
    } else if (reminder.scheduleType === 'cron') {
      await this.scheduleCron({
        jobId: reminder.id,
        cronExpression: reminder.scheduleValue,
        callback,
        startDate: reminder.startDate ? reminder.startDate.toISOString() : undefined,
        endDate: reminder.endDate ? reminder.endDate.toISOString() : undefined,
        callbackData,
      });
    }
  }

  /**
   * Restore all active reminders from storage
   */
  async restoreJobs(): Promise<void> {
    const reminders = await this.app.data.storage.getAllReminders();
    console.log(`[Scheduler] Restoring ${reminders.length} reminders...`);

    for (const r of reminders) {
      await this.scheduleReminder(r);
      console.log(`[Scheduler] Restored reminder: ${r.id}`);
    }
  }

  /**
   * Remove a scheduled job by ID
   */
  async removeJob(jobId: string): Promise<boolean> {
    console.log(`[Scheduler.removeJob] Attempting to remove job: '${jobId}'`);

    try {
      // Use cancel to remove jobs matching the name
      const removed = await this.agenda.cancel({ name: jobId });
      console.log(`[Scheduler.removeJob] Canceled ${removed} job(s) with name '${jobId}'`);

      if (removed > 0) {
        console.log(`[Scheduler] Removed job '${jobId}'`);
        return true;
      } else {
        console.log(`[Scheduler] Job '${jobId}' not found`);
        return false;
      }
    } catch (error) {
      console.error(`[Scheduler.removeJob] Error removing job '${jobId}':`, error);
      return false;
    }
  }

  /**
   * Get the Agenda instance for advanced operations
   */
  getAgenda(): Agenda {
    return this.agenda;
  }
}
