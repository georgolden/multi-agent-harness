import type { LLMToolCall } from '../../utils/message.js';
import type { Session } from '../../services/sessionService/index.js';
import { Type, type Static } from '@sinclair/typebox';
import type { RuntimeUser } from '../../services/userService/index.js';

export const fillTemplateInputSchema = Type.Object({
  message: Type.String({ description: "User's message" }),
  template: Type.String({ description: 'Template to fill (required when starting a new session)' }),
});

export type FillTemplateInput = typeof fillTemplateInputSchema;

export interface FillTemplateContext {
  user: RuntimeUser;
  parent?: Session;
  // Flow session
  session: Session;
}
