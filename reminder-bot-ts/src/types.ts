import { App } from './app.js';

// Shared store for PocketFlow
export type SharedStore<Context = Record<string, any>> = { app: App; context: Context };

export type {
  ChatCompletion,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionMessageFunctionToolCall,
} from 'openai/resources';
