import type { LLMToolCall } from '../../utils/message.js';
import type { Session } from '../../services/sessionService/index.js';
import { Type, type Static } from '@sinclair/typebox';
import { User } from '../../data/userRepository/types.js';

export const fillTemplateInputSchema = Type.Object({
  message: Type.String({ description: "User's message" }),
  template: Type.String({ description: 'Template to fill (required when starting a new session)' }),
});

export type FillTemplateInput = typeof fillTemplateInputSchema;

export interface FillTemplateContext {
  user: User;
  parent?: Session;
  // Flow session
  session: Session;
}
