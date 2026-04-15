import type { Session } from '../../services/sessionService/index.js';
import { Type } from '@sinclair/typebox';
import type { RuntimeUser } from '../../services/userService/index.js';

export const orchestratorInputSchema = Type.Object({
  message: Type.String({ description: "User's message or task description" }),
});

export type OrchestratorInput = typeof orchestratorInputSchema;

export interface OrchestratorContext {
  user: RuntimeUser;
  parent?: Session;
  session: Session;
}
