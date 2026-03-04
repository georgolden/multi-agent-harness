import type { LLMToolCall } from '../../utils/message.js';
import type { Session } from '../../services/sessionService/index.js';
import type { Tool } from '../../tools/index.js';
import type { Skill } from '../../skills/index.js';
import type { User } from '../../data/userRepository/types.js';

export interface AgenticLoopContext {
  user: User;
  parent?: Session;
  session: Session;
  tools: Tool[];
  skills: Skill[];
}
