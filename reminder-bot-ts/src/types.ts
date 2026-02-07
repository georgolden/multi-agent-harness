import { App } from './app.js';

// Core domain types
export interface Reminder {
  id: string;
  userId: string;
  chatId: string;
  text: string;
  scheduleType: 'once' | 'cron';
  scheduleValue: string; // ISO datetime or cron expression
  startDate?: Date;
  endDate?: Date;
  timezone: string;
  createdAt: Date;
  active: boolean;
}

export interface User {
  id: string;
  timezone: string;
}

// Shared store for PocketFlow
export type SharedStore<Context = Record<string, any>> = { app: App; context: Context };

// Tool call types
export interface ToolCall {
  function: {
    name: string;
    arguments: string;
  };
}

export type {
  ChatCompletion,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionMessageFunctionToolCall,
} from 'openai/resources';
