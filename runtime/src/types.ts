import type { Static, TSchema } from "@sinclair/typebox";

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

export interface TextContent {
  type: 'text';
  text: string;
  textSignature?: string;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface Tool<TParameters extends TSchema = TSchema> {
    name: string;
    description: string;
    parameters: TParameters;
}

export interface AgentToolResult<T> {
  // Content blocks supporting text and images
  content: (TextContent | ImageContent)[];
  // Details to be displayed in a UI or logged
  details: T;
}

// Callback for streaming tool execution updates
export type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;

// AgentTool extends Tool but adds the execute function
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
  // A human-readable label for the tool to be displayed in UI
  label: string;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
}

