/**
 * Tool definitions for the reminder bot.
 * These define the actions the LLM can take.
 */
import type { OpenAI } from 'openai';

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
