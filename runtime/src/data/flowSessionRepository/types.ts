/**
 * Flow session types for managing flow execution state and history
 */

import type { ChatCompletionMessageParam, ChatCompletionMessage } from '../../types.js';

// Message without id - index is the id
export interface FlowMessage {
  message: ChatCompletionMessageParam | ChatCompletionMessage;
  timestamp: Date;
}

// Context file reference
export interface ContextFile {
  path: string;
  content: string;
}

// Tool schema - matches real tool format
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON schema for parameters
}

// Skill schema - matches Skill type
export interface SkillSchema {
  name: string;
  description: string;
  location: string;
}

// Tool execution log
export interface ToolLog {
  callId: string;
  name: string;
  input: string;
  output: string;
  startedAt: Date;
  endedAt: Date;
  status: 'success' | 'error';
}

// Skill execution log
export interface SkillLog {
  callId: string;
  name: string;
  input: string;
  output: string;
  startedAt: Date;
  endedAt: Date;
  status: 'success' | 'error';
}

// Message window configuration
export interface MessageWindowConfig {
  // Number of first messages to always keep (system + initial user task)
  keepFirstMessages: number;
  // Size of the sliding window for recent messages
  slidingWindowSize: number;
}

// Default message window configuration
export const DEFAULT_MESSAGE_WINDOW_CONFIG: MessageWindowConfig = {
  keepFirstMessages: 2,
  slidingWindowSize: 20,
};

// Flow session state - simplified
export type FlowSessionStatus = 'running' | 'completed' | 'failed';

// Main flow session type
export interface FlowSession {
  id: string;
  userId: string;
  flowName: string;
  systemPrompt: string;
  userPromptTemplate?: string;
  status: FlowSessionStatus;

  // Tree structure
  parentSessionId?: string;

  // Message history (all messages) - uses OpenAI message format
  messages: FlowMessage[];

  // Active message window (computed based on config)
  activeMessages: FlowMessage[];

  // Message window configuration
  messageWindowConfig: MessageWindowConfig;

  // Context and tools
  contextFiles: ContextFile[];
  tools: ToolSchema[];
  skills: SkillSchema[];

  // Execution logs
  toolLogs: ToolLog[];
  skillLogs: SkillLog[];

  // Timestamps - simple
  startedAt: Date;
  endedAt?: Date;
}

// Create session parameters
export interface CreateSessionParams {
  sessionId?: string;
  userId: string;
  flowName: string;
  systemPrompt: string;
  userPromptTemplate?: string;
  parentSessionId?: string;
  messageWindowConfig?: MessageWindowConfig;
  tools?: ToolSchema[];
  skills?: SkillSchema[];
  contextFiles?: ContextFile[];
}

// Lightweight session info for tree traversal
export interface FlowSessionTreeNode {
  id: string;
  userId: string;
  flowName: string;
  status: FlowSessionStatus;
  parentSessionId?: string;
  createdAt: Date;
  childCount: number;
}
