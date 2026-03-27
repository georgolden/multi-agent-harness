/**
 * Tool definitions for the task bot.
 * These define the actions the LLM can take.
 */
import type { OpenAI } from 'openai';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);
import type { App } from '../../app.js';
import { User } from '../../data/userRepository/types.js';

export const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'schedule_once',
      description: 'Schedule a one-time task at a specific date and time',
      parameters: {
        type: 'object',
        properties: {
          taskName: {
            type: 'string',
            description: 'The type of task to schedule (e.g., "reminder", "runAgentFlow")',
          },
          parameters: {
            type: 'object',
            description: 'Task parameters',
            properties: {
              message: {
                type: 'string',
                description:
                  'Message for the task (for reminders: what to remind about; for agent flows: the input message)',
              },
              agentType: {
                type: 'string',
                enum: ['builtin', 'schema'],
                description:
                  'Agent type: "builtin" for predefined flows, "schema" for stored schema agents. Required only for runAgentFlow task type.',
              },
              flowName: {
                type: 'string',
                description:
                  'Agent flow name (required only for runAgentFlow task type). Use with agentType to specify which agent to run.',
              },
            },
            required: ['message'],
          },
          datetime: {
            type: 'string',
            description: "ISO 8601 datetime string (e.g., '2026-02-02T15:00:00')",
          },
        },
        required: ['taskName', 'parameters', 'datetime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_recurring',
      description: 'Schedule a recurring task using cron syntax',
      parameters: {
        type: 'object',
        properties: {
          taskName: {
            type: 'string',
            description: 'The type of task to schedule (e.g., "reminder", "runAgentFlow")',
          },
          parameters: {
            type: 'object',
            description: 'Task parameters',
            properties: {
              message: {
                type: 'string',
                description:
                  'Message for the task (for reminders: what to remind about; for agent flows: the input message)',
              },
              agentType: {
                type: 'string',
                enum: ['builtin', 'schema'],
                description:
                  'Agent type: "builtin" for predefined flows, "schema" for stored schema agents. Required only for runAgentFlow task type.',
              },
              flowName: {
                type: 'string',
                description:
                  'Agent flow name (required only for runAgentFlow task type). Use with agentType to specify which agent to run.',
              },
            },
            required: ['message'],
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
        required: ['taskName', 'parameters', 'cron_expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_interval',
      description: 'Schedule a recurring interval task using cron syntax',
      parameters: {
        type: 'object',
        properties: {
          taskName: {
            type: 'string',
            description: 'The type of task to schedule (e.g., "reminder", "runAgentFlow")',
          },
          parameters: {
            type: 'object',
            description: 'Task parameters',
            properties: {
              message: {
                type: 'string',
                description:
                  'Message for the task (for reminders: what to remind about; for agent flows: the input message)',
              },
              agentType: {
                type: 'string',
                enum: ['builtin', 'schema'],
                description:
                  'Agent type: "builtin" for predefined flows, "schema" for stored schema agents. Required only for runAgentFlow task type.',
              },
              flowName: {
                type: 'string',
                description:
                  'Agent flow name (required only for runAgentFlow task type). Use with agentType to specify which agent to run.',
              },
            },
            required: ['message'],
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
        required: ['taskName', 'parameters', 'cron_expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: 'List all active tasks for the user',
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
      name: 'cancel_task',
      description: 'Cancel/delete a specific task by its ID',
      parameters: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'The ID of the task to cancel',
          },
        },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_all_tasks',
      description: 'Cancel/delete ALL tasks for the user',
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
      description: "Set the user's preferred timezone for all tasks",
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
   * Schedule a one-time task
   */
  schedule_once: async (
    app: App,
    context: { user: User },
    args: {
      taskName: string;
      parameters: { message: string; agentType?: string; flowName?: string };
      datetime: string;
    },
  ) => {
    try {
      const { user } = context;
      const userId = user.id;
      const userTimezone = await app.data.taskRepository.getUserTimezone(userId);

      // Build parameters with userId
      const taskParameters = {
        userId,
        message: args.parameters.message,
        ...(args.parameters.agentType && { agentType: args.parameters.agentType }),
        ...(args.parameters.flowName && { flowName: args.parameters.flowName }),
      };

      // Save task to taskRepository - datetime is already ISO string
      const task = await app.data.taskRepository.saveTask({
        userId,
        taskName: args.taskName,
        parameters: taskParameters,
        scheduleType: 'once',
        scheduleValue: args.datetime,
        timezone: userTimezone,
      });

      // Schedule the job
      await app.services.scheduler.scheduleTask(task);

      return { status: 'success', task };
    } catch (error: any) {
      console.error('[schedule_once] Error:', error);
      return { status: 'error', error: error?.message };
    }
  },

  /**
   * Schedule a recurring task using cron syntax
   */
  schedule_recurring: async (
    app: App,
    context: { user: User },
    args: {
      taskName: string;
      parameters: { message: string; agentType?: string; flowName?: string };
      cron_expression: string;
      schedule_start_date?: string;
      schedule_end_date?: string;
    },
  ) => {
    try {
      const { user } = context;
      const userId = user.id;
      const userTimezone = await app.data.taskRepository.getUserTimezone(userId);

      // Dates are already ISO strings, just convert to Date objects if provided
      let startDate: Date | undefined;
      let endDate: Date | undefined;

      if (args.schedule_start_date) {
        startDate = new Date(args.schedule_start_date);
      }

      if (args.schedule_end_date) {
        endDate = new Date(args.schedule_end_date);
      }

      // Build parameters with userId
      const taskParameters = {
        userId,
        message: args.parameters.message,
        ...(args.parameters.agentType && { agentType: args.parameters.agentType }),
        ...(args.parameters.flowName && { flowName: args.parameters.flowName }),
      };

      // Save task to taskRepository
      const task = await app.data.taskRepository.saveTask({
        userId,
        taskName: args.taskName,
        parameters: taskParameters,
        scheduleType: 'cron',
        scheduleValue: args.cron_expression,
        startDate,
        endDate,
        timezone: userTimezone,
      });

      // Schedule the cron job
      await app.services.scheduler.scheduleTask(task);

      return { status: 'success', task };
    } catch (error: any) {
      console.error('[schedule_recurring] Error:', error);
      return { status: 'error', error: error?.message };
    }
  },

  /**
   * Schedule an interval task (similar to recurring)
   */
  schedule_interval: async (
    app: App,
    context: { user: User },
    args: {
      taskName: string;
      parameters: { message: string; agentType?: string; flowName?: string };
      cron_expression: string;
      schedule_start_date?: string;
      schedule_end_date?: string;
    },
  ) => {
    // Interval is essentially the same as recurring for this implementation
    return toolHandlers.schedule_recurring(app, context, args);
  },

  /**
   * List all active tasks for the user
   */
  list_tasks: async (app: App, context: { user: User }, _args: {}) => {
    try {
      const { user } = context;
      const userId = user.id;
      const tasks = await app.data.taskRepository.getTasks(userId);
      return { status: 'success', tasks };
    } catch (error: any) {
      console.error('[list_tasks] Error:', error);
      return { status: 'error', error: error?.message };
    }
  },

  /**
   * Cancel a specific task by ID
   */
  cancel_task: async (app: App, context: { user: User }, args: { task_id: string }) => {
    try {
      const { user } = context;
      const userId = user.id;
      // Verify the task belongs to this user
      const task = await app.data.taskRepository.getTaskForUser(args.task_id, userId);

      if (!task) {
        return { status: 'success' };
      }

      // Remove from scheduler first
      await app.services.scheduler.removeJob(task.id);

      // Then delete from taskRepository
      await app.data.taskRepository.deleteTask(task.id);

      return { status: 'success' };
    } catch (error: any) {
      console.error('[cancel_task] Error:', error);
      return { status: 'error', error: error?.message };
    }
  },

  /**
   * Cancel all tasks for the user
   */
  cancel_all_tasks: async (app: App, context: { user: User }, _args: {}) => {
    try {
      const { user } = context;
      const userId = user.id;
      const tasks = await app.data.taskRepository.getTasks(userId);

      if (tasks.length === 0) {
        return { status: 'success' };
      }

      for (const task of tasks) {
        // Remove from scheduler
        await app.services.scheduler.removeJob(task.id);

        // Delete from taskRepository
        await app.data.taskRepository.deleteTask(task.id);
      }

      return { status: 'success' };
    } catch (error: any) {
      console.error('[cancel_all_tasks] Error:', error);
      return { status: 'error', error: error?.message };
    }
  },

  /**
   * Set the user's preferred timezone
   */
  set_timezone: async (app: App, context: { user: User }, args: { timezone: string }) => {
    try {
      const { user } = context;
      const userId = user.id;
      // Validate timezone by trying to use it
      const testDate = dayjs.tz(new Date(), args.timezone);
      if (!testDate.isValid()) {
        return { status: 'error', error: 'Invalid timezone' };
      }

      // Set the timezone in taskRepository
      await app.data.taskRepository.setUserTimezone(userId, args.timezone);

      return { status: 'success' };
    } catch (error: any) {
      console.error('[set_timezone] Error:', error);
      return { status: 'error', error: error?.message };
    }
  },
};

export function createToolHandler(name: string) {
  const handler = toolHandlers[name as keyof typeof toolHandlers];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return async (app: App, context: { user: User }, args: any): Promise<string> => {
    const res = await handler(app, context, args);
    return JSON.stringify(res);
  };
}
