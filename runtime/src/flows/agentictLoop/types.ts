import type { ChatCompletionMessageFunctionToolCall } from '../../types.js';
import type { FlowSession } from '../../data/flowSessionRepository/types.js';
import type { Tool } from '../../tools/index.js';
import type { Skill } from '../../skills/index.js';
import type { User } from '../../data/userRepository/types.js';

/**
 * FlowSession enriched with actual tool/skill instances (in addition to schemas stored in DB).
 * Created by prepareAgenticLoop before the flow runs.
 */
export interface AgenticLoopSession extends FlowSession {
  tools: Tool[];
  skills: Skill[];
}

/**
 * The shared context throughout agentic loop execution.
 * Seeded by prepareAgenticLoop: { session, user, message }.
 * Mutated by nodes as the loop progresses.
 */
export interface AgenticLoopContext {
  user: User;
  message: string;
  session: AgenticLoopSession;

  // Mutable flow state
  response?: string;
  toolCalls?: ChatCompletionMessageFunctionToolCall[];
  iteration?: number;
}

// Narrowed contexts for nodes that require specific fields
export type AskUserContext = AgenticLoopContext & { response: string };
export type ToolCallsContext = AgenticLoopContext & { toolCalls: ChatCompletionMessageFunctionToolCall[] };
