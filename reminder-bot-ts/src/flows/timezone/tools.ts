import type { OpenAI } from 'openai';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);
import type { App } from '../../app.js';

export const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'set_timezone',
      description: "Set the user's timezone after extracting it from their message",
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: "IANA timezone identifier (e.g., 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'UTC')",
          },
        },
        required: ['timezone'],
      },
    },
  },
];

const toolHandlers = {
  set_timezone: async (app: App, context: { userId: string; chatId: string }, args: { timezone: string }) => {
    try {
      const { userId } = context;
      const testDate = dayjs.tz(new Date(), args.timezone);
      if (!testDate.isValid()) {
        return { status: 'error', error: 'Invalid timezone' };
      }
      await app.data.reminderRepository.setUserTimezone(userId, args.timezone);
      return { status: 'success' };
    } catch (error: any) {
      console.error('[timezone/set_timezone] Error:', error);
      return { status: 'error', error: error?.message };
    }
  },
};

export function createToolHandler(name: string) {
  const handler = toolHandlers[name as keyof typeof toolHandlers];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return async (app: App, context: { userId: string; chatId: string }, args: any): Promise<string> => {
    const res = await handler(app, context, args);
    return JSON.stringify(res);
  };
}
