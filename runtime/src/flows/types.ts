import type { TObject, Static } from '@sinclair/typebox';
import type { Flow } from '../utils/agent/flow.js';
import type { Session } from '../services/sessionService/session.js';
import type { App } from '../app.js';
import type { FlowContext } from './index.js';

/**
 * Generic flow definition. Every flow exports a const of this shape.
 *
 * TSchema — a Typebox TObject describing the parameters.
 * The run() third argument is inferred as Static<TSchema>.
 */
export type FlowDef<TSchema extends TObject = TObject> = {
  name: string;
  description: string;
  parameters: TSchema;
  run: (
    app: App,
    context: FlowContext,
    parameters: Static<TSchema>,
  ) => Promise<{ flow: Flow<any, any, any, any>; session: Session; promise: Promise<unknown> }>;
};

/**
 * A live reference to a running flow execution.
 * Returned by Flows.runFlow() immediately after session creation and flow start.
 */
export type FlowHandle<TResult = unknown> = {
  /** The Flow instance — for abort/pause/resume control */
  flow: Flow<any, any, any, any>;
  /** The Session instance — for reading status, messages, and current state */
  session: Session;
  /** Resolves when the flow completes (success or error) */
  promise: Promise<TResult>;
};

/**
 * Persistent record of a single flow execution stored in the DB.
 */
export type FlowRunRecord = {
  id: string;
  flowName: string;
  sessionId: string;
  userId: string;
  status: FlowRunStatus;
  startedAt: Date;
  endedAt?: Date;
  parentSessionId?: string;
};

export type FlowRunStatus = 'running' | 'completed' | 'failed' | 'paused';
