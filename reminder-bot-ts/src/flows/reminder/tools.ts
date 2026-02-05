/**
 * Tool definitions for the reminder bot.
 * These define the actions the LLM can take.
 */
import type { OpenAI } from 'openai';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);
import { App } from '../../app.js';

export const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'schedule_once',
      description: 'Schedule a one-time reminder at a specific date and time',
      parameters: {
        type: 'object',
        properties: {
          reminder_text: {
            type: 'string',
            description: 'What to remind the user about',
          },
          datetime: {
            type: 'string',
            description: "ISO 8601 datetime string (e.g., '2026-02-02T15:00:00')",
          },
        },
        required: ['reminder_text', 'datetime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_recurring',
      description: 'Schedule a recurring reminder using cron syntax',
      parameters: {
        type: 'object',
        properties: {
          reminder_text: {
            type: 'string',
            description: 'What to remind the user about',
          },
          cron_expression: {
            type: 'string',
            description:
              "5-field cron expression (minute hour day month weekday). Example: '0 9 * * *' for daily at 9am",
          },
          schedule_start_date: {
            type: 'string',
            description: "ISO 8601 end datetime (e.g., '2026-01-30T01:40:00')",
          },
          schedule_end_date: {
            type: 'string',
            description: "ISO 8601 end datetime (e.g., '2026-01-30T01:40:00')",
          },
        },
        required: ['reminder_text', 'cron_expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_interval',
      description: 'Schedule a recurring interval reminder using cron syntax',
      parameters: {
        type: 'object',
        properties: {
          reminder_text: {
            type: 'string',
            description: 'What to remind the user about',
          },
          cron_expression: {
            type: 'string',
            description:
              "5-field cron expression (minute hour day month weekday). Example: '0 9 * * *' for daily at 9am",
          },
          schedule_start_date: {
            type: 'string',
            description: "ISO 8601 end datetime (e.g., '2026-01-30T01:40:00')",
          },
          schedule_end_date: {
            type: 'string',
            description: "ISO 8601 end datetime (e.g., '2026-01-30T01:40:00')",
          },
        },
        required: ['reminder_text', 'cron_expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_reminders',
      description: 'List all active reminders for the user',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_reminder',
      description: 'Cancel/delete a specific reminder by its ID',
      parameters: {
        type: 'object',
        properties: {
          reminder_id: {
            type: 'string',
            description: 'The ID of the reminder to cancel',
          },
        },
        required: ['reminder_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_all_reminders',
      description: 'Cancel/delete ALL reminders for the user',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_timezone',
      description: "Set the user's preferred timezone for all reminders",
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: "IANA timezone (e.g., 'Europe/London', 'America/New_York', 'UTC')",
          },
        },
        required: ['timezone'],
      },
    },
  },
];

const toolHandlers = {
  /**
   * Schedule a one-time reminder
   */
  schedule_once: async (
    app: App,
    userId: string,
    chatId: string,
    args: { reminder_text: string; datetime: string },
  ) => {
    try {
      const userTimezone = await app.data.storage.getUserTimezone(userId);

      // Save reminder to storage - datetime is already ISO string
      const reminder = await app.data.storage.saveReminder({
        userId,
        chatId,
        text: args.reminder_text,
        scheduleType: 'once',
        scheduleValue: args.datetime,
        timezone: userTimezone,
      });

      // Schedule the job
      await app.services.scheduler.scheduleReminder(reminder);

      const formattedTime = dayjs(args.datetime).tz(userTimezone).format('YYYY-MM-DD HH:mm:ss');
      return `✅ Reminder scheduled for ${formattedTime} ${userTimezone}\nID: ${reminder.id}`;
    } catch (error: any) {
      console.error('[schedule_once] Error:', error);
      return `❌ Failed to schedule reminder: ${error.message}`;
    }
  },

  /**
   * Schedule a recurring reminder using cron syntax
   */
  schedule_recurring: async (
    app: App,
    userId: string,
    chatId: string,
    args: { reminder_text: string; cron_expression: string; schedule_start_date?: string; schedule_end_date?: string },
  ) => {
    try {
      const userTimezone = await app.data.storage.getUserTimezone(userId);

      // Dates are already ISO strings, just convert to Date objects if provided
      let startDate: Date | undefined;
      let endDate: Date | undefined;

      if (args.schedule_start_date) {
        startDate = new Date(args.schedule_start_date);
      }

      if (args.schedule_end_date) {
        endDate = new Date(args.schedule_end_date);
      }

      // Save reminder to storage
      const reminder = await app.data.storage.saveReminder({
        userId,
        chatId,
        text: args.reminder_text,
        scheduleType: 'cron',
        scheduleValue: args.cron_expression,
        startDate,
        endDate,
        timezone: userTimezone,
      });

      // Schedule the cron job
      await app.services.scheduler.scheduleReminder(reminder);

      let dateInfo = '';
      if (args.schedule_start_date) dateInfo += `\nStarts: ${args.schedule_start_date}`;
      if (args.schedule_end_date) dateInfo += `\nEnds: ${args.schedule_end_date}`;

      return `✅ Recurring reminder scheduled with cron: ${args.cron_expression}${dateInfo}\nID: ${reminder.id}`;
    } catch (error: any) {
      console.error('[schedule_recurring] Error:', error);
      return `❌ Failed to schedule recurring reminder: ${error.message}`;
    }
  },

  /**
   * Schedule an interval reminder (similar to recurring)
   */
  schedule_interval: async (
    app: App,
    userId: string,
    chatId: string,
    args: { reminder_text: string; cron_expression: string; schedule_start_date?: string; schedule_end_date?: string },
  ) => {
    // Interval is essentially the same as recurring for this implementation
    return toolHandlers.schedule_recurring(app, userId, chatId, args);
  },

  /**
   * List all active reminders for the user
   */
  list_reminders: async (app: App, userId: string, _chatId: string, _args: {}) => {
    try {
      const reminders = await app.data.storage.getReminders(userId);
      const userTimezone = await app.data.storage.getUserTimezone(userId);

      if (reminders.length === 0) {
        return '📋 You have no active reminders.';
      }

      const reminderList = reminders
        .map((r) => {
          const type = r.scheduleType === 'once' ? '🔔 One-time' : '🔁 Recurring';
          const schedule =
            r.scheduleType === 'once'
              ? dayjs(r.scheduleValue).tz(userTimezone).format('YYYY-MM-DD HH:mm:ss')
              : `Cron: ${r.scheduleValue}`;
          return `${type} [ID: ${r.id}]\n  ${r.text}\n  ${schedule} (${userTimezone})`;
        })
        .join('\n\n');

      return `📋 Your active reminders (${reminders.length}):\n\n${reminderList}`;
    } catch (error: any) {
      console.error('[list_reminders] Error:', error);
      return `❌ Failed to list reminders: ${error.message}`;
    }
  },

  /**
   * Cancel a specific reminder by ID
   */
  cancel_reminder: async (app: App, userId: string, _chatId: string, args: { reminder_id: string }) => {
    try {
      // Verify the reminder belongs to this user
      const reminder = await app.data.storage.getReminderForUser(args.reminder_id, userId);

      if (!reminder) {
        return `❌ Reminder ${args.reminder_id} not found or doesn't belong to you.`;
      }

      // Remove from scheduler first
      await app.services.scheduler.removeJob(reminder.id);

      // Then delete from storage
      await app.data.storage.deleteReminder(reminder.id);

      return `✅ Reminder ${args.reminder_id} has been cancelled.`;
    } catch (error: any) {
      console.error('[cancel_reminder] Error:', error);
      return `❌ Failed to cancel reminder: ${error.message}`;
    }
  },

  /**
   * Cancel all reminders for the user
   */
  cancel_all_reminders: async (app: App, userId: string, _chatId: string, _args: {}) => {
    try {
      const reminders = await app.data.storage.getReminders(userId);

      if (reminders.length === 0) {
        return '📋 You have no active reminders to cancel.';
      }

      let cancelledCount = 0;

      for (const reminder of reminders) {
        // Remove from scheduler
        await app.services.scheduler.removeJob(reminder.id);

        // Delete from storage
        await app.data.storage.deleteReminder(reminder.id);

        cancelledCount++;
      }

      return `✅ Cancelled ${cancelledCount} reminder(s).`;
    } catch (error: any) {
      console.error('[cancel_all_reminders] Error:', error);
      return `❌ Failed to cancel all reminders: ${error.message}`;
    }
  },

  /**
   * Set the user's preferred timezone
   */
  set_timezone: async (app: App, userId: string, _chatId: string, args: { timezone: string }) => {
    try {
      // Validate timezone by trying to use it
      const testDate = dayjs.tz(new Date(), args.timezone);
      if (!testDate.isValid()) {
        return `❌ Invalid timezone: ${args.timezone}`;
      }

      // Set the timezone in storage
      await app.data.storage.setUserTimezone(userId, args.timezone);

      const currentTime = dayjs().tz(args.timezone).format('YYYY-MM-DD HH:mm:ss');
      return `✅ Timezone set to ${args.timezone}\nCurrent time: ${currentTime}`;
    } catch (error: any) {
      console.error('[set_timezone] Error:', error);
      return `❌ Failed to set timezone: ${error.message}`;
    }
  },
};

export function createToolHandler(name: string) {
  const handler = toolHandlers[name as keyof typeof toolHandlers];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return handler;
}
