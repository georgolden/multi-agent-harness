import type { Session } from '../../services/sessionService/index.js';
import { Type } from '@sinclair/typebox';
import type { RuntimeUser } from '../../services/userService/index.js';

export const agentBuilderInputSchema = Type.Object({
  message: Type.String({ description: "User's message" }),
});

export type AgentBuilderInput = typeof agentBuilderInputSchema;

export interface AgentBuilderContext {
  user: User;
  parent?: Session;
  session: Session;
}
