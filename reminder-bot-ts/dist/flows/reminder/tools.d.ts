/**
 * Tool definitions for the reminder bot.
 * These define the actions the LLM can take.
 */
import type { OpenAI } from 'openai';
import type { App } from '../../app.js';
export declare const TOOLS: OpenAI.ChatCompletionTool[];
export declare function createToolHandler(name: string): (app: App, context: {
    userId: string;
    chatId: string;
}, args: any) => Promise<string>;
