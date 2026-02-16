/**
 * Scheduler service using Agenda with Postgres backend.
 * Handles one-time and recurring task jobs.
 */
import { Agenda } from 'agenda';
import type { Job } from 'agenda';
import { PostgresBackend } from '@agendajs/postgres-backend';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import type { Task } from '../../data/taskRepository/types.js';
import type { App } from '../../app.js';

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
    await this.restoreJobs();
    await this.agenda.start();
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
   * Schedule a one-time task
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
   * Schedule a recurring task using cron expression
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
    console.log(
      `[Scheduler] Scheduled cron job '${params.jobId}' with expression '${params.cronExpression}' in timezone ${timezone}${endInfo}`,
    );
  }

  /**
   * Callback function that executes when a task fires
   */
  private async onSchedulerFire(job: Job): Promise<void> {
    const { taskName, parameters, taskId, scheduleType } = job.attrs.data as {
      taskName: string;
      parameters: Record<string, unknown>;
      taskId: string;
      scheduleType: string;
    };
    console.log(`[SchedulerFire] Executing task ${taskId} ${taskName} with ${JSON.stringify(parameters)}`);

    try {
      await this.app.tasks.runTask(taskName, parameters);
      // For one-time reminders, mark as inactive after firing
      if (scheduleType === 'once') {
        await this.app.data.taskRepository.deleteTask(taskId);
      }
    } catch (error) {
      console.error(`[SchedulerFire] Error sending task ${taskId}:`, error);
    }
  }

  /**
   * Schedule a task from a Task object
   */
  async scheduleTask(task: Task): Promise<void> {
    const callbackData = {
      taskId: task.id,
      scheduleType: task.scheduleType,
      taskName: task.taskName,
      parameters: task.parameters,
    };

    const callback = (job: Job) => this.onSchedulerFire(job);

    try {
      if (task.scheduleType === 'once') {
        await this.scheduleOnce({
          jobId: task.id,
          runDate: task.scheduleValue,
          callback,
          callbackData,
        });
      } else if (task.scheduleType === 'cron') {
        await this.scheduleCron({
          jobId: task.id,
          cronExpression: task.scheduleValue,
          callback,
          startDate: task.startDate ? task.startDate.toISOString() : undefined,
          endDate: task.endDate ? task.endDate.toISOString() : undefined,
          timezone: task.timezone,
          callbackData,
        });
      } else {
        console.error(`[Scheduler.scheduleScheduler] Unknown schedule type: ${task.scheduleType}`);
        throw new Error(`Unknown schedule type: ${task.scheduleType}`);
      }
    } catch (error) {
      console.error(`[Scheduler.scheduleScheduler] Error:`, error);
      throw error;
    }
  }

  /**
   * Restore job definitions for existing reminders.
   * This is necessary because Agenda requires job definitions to be loaded in memory
   * to process jobs stored in the database.
   */
  async restoreJobs(): Promise<void> {
    console.log('[Scheduler.restoreJobs] Restoring job definitions...');
    const reminders = await this.app.data.taskRepository.getAllTasks();

    if (reminders.length === 0) {
      console.log('[Scheduler.restoreJobs] No reminders to restore');
      return;
    }

    for (const task of reminders) {
      // We only define the job processor.
      // We do NOT call schedule() or create() because the job data is already in the Agenda DB.
      this.agenda.define(task.id, (job: Job) => this.onSchedulerFire(job));
    }

    console.log(`[Scheduler.restoreJobs] Restored definitions for ${reminders.length} reminders`);
  }

  /**
   * Remove a scheduled job by ID
   */
  async removeJob(jobId: string): Promise<boolean> {
    try {
      // Use cancel to remove jobs matching the name
      const removed = await this.agenda.cancel({ name: jobId });

      if (removed > 0) {
        console.log(`[Scheduler] Removed job '${jobId}'`);
        return true;
      } else {
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

if (!process.env.DATABASE_URL) {
  throw new Error('Env DATABASE_URL is not defined');
}

export const config = {
  connectionString: process.env.DATABASE_URL,
};
