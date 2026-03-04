import type { LLMToolCall } from '../../utils/message.js';
import type { Session } from '../../services/sessionService/index.js';
import { Type, type Static } from '@sinclair/typebox';

export const fillTemplateInputSchema = Type.Object({
  userId: Type.String({ description: 'User ID' }),
  message: Type.String({ description: "User's message" }),
  template: Type.Optional(Type.String({ description: 'Template to fill (required when starting a new session)' })),
  parentId: Type.Optional(Type.String({ description: 'Parent session id' })),
});

export type FillTemplateInput = Omit<Static<typeof fillTemplateInputSchema>, 'message'>;

export interface FillTemplateContext extends FillTemplateInput {
  // Flow session
  session?: Session;
  // Flow state
  response?: string;
  toolCalls?: LLMToolCall[];
  result?: string;
}
