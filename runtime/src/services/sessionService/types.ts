import type { FlowSessionStatus } from '../../data/flowSessionRepository/types.js';
import type { Session } from './session.js';

/**
 * Lifecycle hooks for a Session.
 *
 * onMessage       — fired after messages are added to the session
 * onStatusChange  — fired on every status transition (general hook)
 * onRunning       — fired when status transitions to 'running'
 * onCompleted     — fired when status transitions to 'completed'
 * onFailed        — fired when status transitions to 'failed'
 * onPaused        — fired when status transitions to 'paused'
 *
 * All hooks receive the Session instance so they can read current state
 * or call further methods.  onStatusChange also receives previous status.
 *
 * Hooks are called AFTER the repository has been updated.
 */
export interface SessionHooks {
  onMessage?: (session: Session) => void | Promise<void>;
  onStatusChange?: (session: Session, from: FlowSessionStatus, to: FlowSessionStatus) => void | Promise<void>;
  onRunning?: (session: Session) => void | Promise<void>;
  onCompleted?: (session: Session) => void | Promise<void>;
  onFailed?: (session: Session) => void | Promise<void>;
  onPaused?: (session: Session) => void | Promise<void>;
}
