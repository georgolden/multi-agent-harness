import type { Session } from '../../services/sessionService/index.js';
import type { Tool } from '../../tools/index.js';
import type { Skill } from '../../skills/index.js';
import type { RuntimeUser } from '../../services/userService/index.js';

export interface AgenticLoopContext {
  user: RuntimeUser;
  parent?: Session;
  session: Session;
  tools: Tool[];
  skills: Skill[];
}
