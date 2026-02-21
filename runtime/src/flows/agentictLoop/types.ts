import type { ChatCompletionMessageFunctionToolCall } from '../../types.js';
import type { Session } from '../../services/sessionService/index.js';
import type { Tool } from '../../tools/index.js';
import type { Skill } from '../../skills/index.js';
import type { User } from '../../data/userRepository/types.js';

export interface AgenticLoopContext {
  user: User;
  message: string;
  session: Session;
  tools: Tool[];
  skills: Skill[];

  // Mutable flow state
  response?: string;
  toolCalls?: ChatCompletionMessageFunctionToolCall[];
  iteration?: number;
}

// Narrowed contexts for nodes that require specific fields
export type AskUserContext = AgenticLoopContext & { response: string };
export type ToolCallsContext = AgenticLoopContext & { toolCalls: ChatCompletionMessageFunctionToolCall[] };
