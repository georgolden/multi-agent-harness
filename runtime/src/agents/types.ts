import type { Flow } from '../utils/agent/flow.js';
import type { Session } from '../services/sessionService/session.js';

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
