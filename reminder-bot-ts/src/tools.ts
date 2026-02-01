/**
 * Tool definitions for the reminder bot.
 * These define the actions the LLM can take.
 */
import type { OpenAI } from 'openai'

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
          datetime_iso: {
            type: 'string',
            description: "ISO 8601 datetime string (e.g., '2026-02-02T15:00:00')",
          },
          timezone: {
            type: 'string',
            description: "IANA timezone (use user's stored timezone)",
          },
        },
        required: ['reminder_text', 'datetime_iso', 'timezone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_cron',
      description: 'Schedule a recurring reminder using cron syntax (no end date)',
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
          timezone: {
            type: 'string',
            description: "IANA timezone (use user's stored timezone)",
          },
        },
        required: ['reminder_text', 'cron_expression', 'timezone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_cron_finite',
      description: 'Schedule a recurring reminder using cron syntax with a required end datetime',
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
          end_datetime_iso: {
            type: 'string',
            description: "ISO 8601 end datetime (e.g., '2026-01-30T01:40:00')",
          },
          timezone: {
            type: 'string',
            description: "IANA timezone (use user's stored timezone)",
          },
        },
        required: ['reminder_text', 'cron_expression', 'end_datetime_iso', 'timezone'],
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
      name: 'edit_reminder',
      description:
        'Edit an existing reminder by ID. Cancel old reminder, then schedule a new one from natural language.',
      parameters: {
        type: 'object',
        properties: {
          reminder_id: {
            type: 'string',
            description: 'Existing reminder ID to edit',
          },
          reminder_name: {
            type: 'string',
            description: 'Existing reminder name/text (for verification)',
          },
          new_reminder_name: {
            type: 'string',
            description: 'New reminder name/text (use same as existing if unchanged)',
          },
          new_query: {
            type: 'string',
            description:
              'Natural language description of the updated reminder (must include new reminder name and schedule)',
          },
          timezone: {
            type: 'string',
            description: "IANA timezone (use user's stored timezone)",
          },
        },
        required: ['reminder_id', 'reminder_name', 'new_reminder_name', 'new_query', 'timezone'],
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
      name: 'ask_user',
      description: 'Ask the user for missing information - USE SPARINGLY, only when absolutely necessary',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question to ask the user',
          },
        },
        required: ['question'],
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
]
