import type { AgenticLoopSchema } from '../../agents/agentictLoop/flow.js';

export interface StoredAgenticLoopSchema extends AgenticLoopSchema {
  userId?: string;
}

export type RepositoryHook = {
  onInsert?: (schema: StoredAgenticLoopSchema) => void | Promise<void>;
  onUpdate?: (schema: StoredAgenticLoopSchema) => void | Promise<void>;
  onDelete?: (flowName: string) => void | Promise<void>;
};
