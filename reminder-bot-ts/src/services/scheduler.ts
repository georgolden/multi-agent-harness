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
    console.log('[Scheduler.start] Starting Agenda scheduler...');
    console.log('[Scheduler.start] Process every: 30 seconds');
    console.log('[Scheduler.start] Max concurrency: 20');
    await this.agenda.start();
    await this.restoreJobs();
    console.log('[Scheduler] Started successfully');
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
    console.log(`[Scheduler.scheduleOnce] Starting to schedule job '${params.jobId}'`);
    console.log(`[Scheduler.scheduleOnce] Input runDate: ${params.runDate}`);
    console.log(`[Scheduler.scheduleOnce] Callback data:`, JSON.stringify(params.callbackData));

    // Parse the run date (always UTC)
    const parsedDate = dayjs.utc(params.runDate).toDate();
    console.log(`[Scheduler.scheduleOnce] Parsed date: ${parsedDate.toISOString()}`);
    console.log(`[Scheduler.scheduleOnce] Time until execution: ${parsedDate.getTime() - Date.now()}ms`);

    // Define the job type with the callback
    console.log(`[Scheduler.scheduleOnce] Defining job type '${params.jobId}'`);
    this.agenda.define(params.jobId, params.callback);

    // Schedule the job
    console.log(`[Scheduler.scheduleOnce] Scheduling job to run at ${parsedDate.toISOString()}`);
    const job = await this.agenda.schedule(parsedDate, params.jobId, params.callbackData);
    console.log(`[Scheduler.scheduleOnce] Job scheduled successfully. Job attrs:`, {
      name: job.attrs.name,
      nextRunAt: job.attrs.nextRunAt,
      lastRunAt: job.attrs.lastRunAt,
      data: job.attrs.data,
    });

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
    timezone?: string;
    callbackData: Record<string, unknown>;
  }): Promise<void> {
    console.log(`[Scheduler.scheduleCron] Starting to schedule cron job '${params.jobId}'`);
    console.log(`[Scheduler.scheduleCron] Cron expression: ${params.cronExpression}`);
    console.log(`[Scheduler.scheduleCron] Timezone: ${params.timezone || 'UTC'}`);
    console.log(`[Scheduler.scheduleCron] Start date: ${params.startDate || 'none'}`);
    console.log(`[Scheduler.scheduleCron] End date: ${params.endDate || 'none'}`);
    console.log(`[Scheduler.scheduleCron] Callback data:`, JSON.stringify(params.callbackData));

    // Convert 5-field cron to 6-field cron (Agenda uses 6 fields)
    // 5-field: minute hour day month weekday
    // 6-field: second minute hour day month weekday
    const cronParts = params.cronExpression.trim().split(/\s+/);
    if (cronParts.length !== 5) {
      throw new Error(`Invalid cron expression: expected 5 fields, got ${cronParts.length}`);
    }
    const agendaCron = `0 ${params.cronExpression}`; // Add "0" for seconds
    console.log(`[Scheduler.scheduleCron] Converted to 6-field cron: ${agendaCron}`);

    // Define the job type
    console.log(`[Scheduler.scheduleCron] Defining job type '${params.jobId}'`);
    this.agenda.define(params.jobId, params.callback);

    // Schedule the job
    console.log(`[Scheduler.scheduleCron] Creating job instance`);
    const job = this.agenda.create(params.jobId, params.callbackData);

    const timezone = params.timezone || 'UTC';
    console.log(`[Scheduler.scheduleCron] Setting repeat schedule with timezone: ${timezone}`);
    job.repeatEvery(agendaCron, {
      timezone,
      skipImmediate: true,
    });

    // Set start date if provided
    if (params.startDate) {
      const parsedStartDate = dayjs.utc(params.startDate).toDate();
      console.log(`[Scheduler.scheduleCron] Setting start date: ${parsedStartDate.toISOString()}`);
      job.startDate(parsedStartDate);
    }

    // Set end date if provided
    if (params.endDate) {
      const parsedEndDate = dayjs.utc(params.endDate).toDate();
      console.log(`[Scheduler.scheduleCron] Setting end date: ${parsedEndDate.toISOString()}`);
      job.endDate(parsedEndDate);
    }

    console.log(`[Scheduler.scheduleCron] Saving job to database`);
    await job.save();

    console.log(`[Scheduler.scheduleCron] Job saved successfully. Job attrs:`, {
      name: job.attrs.name,
      nextRunAt: job.attrs.nextRunAt,
      lastRunAt: job.attrs.lastRunAt,
      repeatInterval: job.attrs.repeatInterval,
      repeatTimezone: job.attrs.repeatTimezone,
      startDate: job.attrs.startDate,
      endDate: job.attrs.endDate,
      data: job.attrs.data,
    });

    const endInfo = params.endDate ? ` (ends: ${params.endDate})` : '';
    console.log(
      `[Scheduler] Scheduled cron job '${params.jobId}' with expression '${params.cronExpression}' in timezone ${timezone}${endInfo}`,
    );
  }

  /**
   * Callback function that executes when a reminder fires
   */
  private async onReminderFire(job: Job): Promise<void> {
    console.log(`[ReminderFire] ========== JOB FIRING ==========`);
    console.log(`[ReminderFire] Job name: ${job.attrs.name}`);
    console.log(`[ReminderFire] Job scheduled at: ${job.attrs.nextRunAt}`);
    console.log(`[ReminderFire] Current time: ${new Date().toISOString()}`);
    console.log(`[ReminderFire] Job data:`, JSON.stringify(job.attrs.data));

    const { chatId, text, reminderId, scheduleType } = job.attrs.data as {
      chatId: string;
      text: string;
      reminderId: string;
      scheduleType: string;
    };
    console.log(
      `[ReminderFire] Extracted - chatId: ${chatId}, reminderId: ${reminderId}, scheduleType: ${scheduleType}`,
    );
    console.log(`[ReminderFire] Message text: "${text}"`);
    console.log(`[ReminderFire] Sending reminder ${reminderId} to chat ${chatId}`);

    try {
      console.log(`[ReminderFire] Calling telegram.sendMessage...`);
      this.app.infra.bus.emit('telegram.sendMessage', { chatId, message: `⏰ Reminder: ${text}` });

      // For one-time reminders, mark as inactive after firing
      if (scheduleType === 'once') {
        console.log(`[ReminderFire] This is a one-time reminder, deleting from storage...`);
        await this.app.data.storage.deleteReminder(reminderId);
        console.log(`[ReminderFire] Deleted one-time reminder ${reminderId}`);
      } else {
        console.log(`[ReminderFire] This is a recurring reminder (${scheduleType}), keeping in storage`);
      }

      console.log(`[ReminderFire] ========== JOB COMPLETED ==========`);
    } catch (error) {
      console.error(`[ReminderFire] ========== ERROR OCCURRED ==========`);
      console.error(`[ReminderFire] Error sending reminder ${reminderId}:`, error);
      console.error(`[ReminderFire] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
      console.error(`[ReminderFire] ========== END ERROR ==========`);
    }
  }

  /**
   * Schedule a reminder from a Reminder object
   */
  async scheduleReminder(reminder: Reminder): Promise<void> {
    console.log(`[Scheduler.scheduleReminder] ---------- SCHEDULING REMINDER ----------`);
    console.log(`[Scheduler.scheduleReminder] Reminder ID: ${reminder.id}`);
    console.log(`[Scheduler.scheduleReminder] Chat ID: ${reminder.chatId}`);
    console.log(`[Scheduler.scheduleReminder] Text: "${reminder.text}"`);
    console.log(`[Scheduler.scheduleReminder] Schedule Type: ${reminder.scheduleType}`);
    console.log(`[Scheduler.scheduleReminder] Schedule Value: ${reminder.scheduleValue}`);
    console.log(`[Scheduler.scheduleReminder] Start Date: ${reminder.startDate?.toISOString() || 'none'}`);
    console.log(`[Scheduler.scheduleReminder] End Date: ${reminder.endDate?.toISOString() || 'none'}`);

    const callbackData = {
      chatId: reminder.chatId,
      text: reminder.text,
      reminderId: reminder.id,
      scheduleType: reminder.scheduleType,
    };

    const callback = (job: Job) => this.onReminderFire(job);

    try {
      if (reminder.scheduleType === 'once') {
        console.log(`[Scheduler.scheduleReminder] Scheduling as one-time reminder`);
        await this.scheduleOnce({
          jobId: reminder.id,
          runDate: reminder.scheduleValue,
          callback,
          callbackData,
        });
      } else if (reminder.scheduleType === 'cron') {
        console.log(`[Scheduler.scheduleReminder] Scheduling as cron reminder`);
        await this.scheduleCron({
          jobId: reminder.id,
          cronExpression: reminder.scheduleValue,
          callback,
          startDate: reminder.startDate ? reminder.startDate.toISOString() : undefined,
          endDate: reminder.endDate ? reminder.endDate.toISOString() : undefined,
          timezone: reminder.timezone,
          callbackData,
        });
      } else {
        console.error(`[Scheduler.scheduleReminder] Unknown schedule type: ${reminder.scheduleType}`);
        throw new Error(`Unknown schedule type: ${reminder.scheduleType}`);
      }
      console.log(`[Scheduler.scheduleReminder] ---------- SCHEDULING COMPLETE ----------`);
    } catch (error) {
      console.error(`[Scheduler.scheduleReminder] ---------- SCHEDULING FAILED ----------`);
      console.error(`[Scheduler.scheduleReminder] Error:`, error);
      console.error(
        `[Scheduler.scheduleReminder] Error stack:`,
        error instanceof Error ? error.stack : 'No stack trace',
      );
      throw error;
    }
  }

  /**
   * Restore all active reminders from storage
   */
  async restoreJobs(): Promise<void> {
    console.log(`[Scheduler.restoreJobs] ========================================`);
    console.log(`[Scheduler.restoreJobs] Starting job restoration process...`);

    const reminders = await this.app.data.storage.getAllReminders();
    console.log(`[Scheduler.restoreJobs] Found ${reminders.length} reminders in storage`);

    if (reminders.length === 0) {
      console.log(`[Scheduler.restoreJobs] No reminders to restore`);
      console.log(`[Scheduler.restoreJobs] ========================================`);
      return;
    }

    console.log(`[Scheduler.restoreJobs] Restoring ${reminders.length} reminders...`);

    let successCount = 0;
    let failureCount = 0;

    for (const r of reminders) {
      console.log(`[Scheduler.restoreJobs] Restoring reminder ${successCount + failureCount + 1}/${reminders.length}`);
      try {
        await this.scheduleReminder(r);
        successCount++;
        console.log(`[Scheduler.restoreJobs] ✓ Successfully restored reminder: ${r.id}`);
      } catch (error) {
        failureCount++;
        console.error(`[Scheduler.restoreJobs] ✗ Failed to restore reminder ${r.id}:`, error);
      }
    }

    console.log(`[Scheduler.restoreJobs] ========================================`);
    console.log(`[Scheduler.restoreJobs] Restoration complete: ${successCount} succeeded, ${failureCount} failed`);
    console.log(`[Scheduler.restoreJobs] ========================================`);
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
