import type { TObject } from '@sinclair/typebox';
import type { App } from '../../app.js';
import type { Flow, SinglePacket } from './flow.js';
import type { User } from '../../data/userRepository/types.js';
import { Session } from '../../services/sessionService/session.js';
import type { FlowContext } from '../../flows/index.js';

/**
 * Abstract base class for all flow runners.
 *
 * A FlowRunner is stateful — after start() or restore() it holds the live
 * flow, session, and promise as properties. It is also self-describing:
 * name, description, and parameters replace the old FlowDef object entirely.
 *
 * Serialization:
 *   - serializePacketData: default converts Session → null, passes everything else as-is.
 *     Override only if a flow stores non-Session objects that need special handling.
 *   - sessionCarryingNodes: list the node names whose packet.data IS the session object.
 *     The base deserializePacketData returns session for those nodes, stored data otherwise.
 */
export abstract class FlowRunner<TContext, TParameters> {
  abstract readonly flowName: string;
  abstract readonly description: string;
  abstract readonly parameters: TObject;

  // ── Live state (set after start / restore) ───────────────────────────────
  flow!: Flow<App, TContext, any, any>;
  session!: Session;
  promise!: Promise<any>;

  // ── Abstract lifecycle ───────────────────────────────────────────────────

  /** Create a brand-new session in DB for a fresh run. */
  abstract createSession(app: App, flowContext: FlowContext, params: TParameters): Promise<Session>;

  /**
   * Build the flow-specific context object from an existing session + user.
   * Called both on fresh start AND on restore.
   */
  abstract createContext(
    app: App,
    flowContext: FlowContext,
    session: Session,
    params: TParameters,
  ): Promise<TContext>;

  /** Instantiate a fresh flow graph (nodes + wiring). */
  abstract createFlow(): Flow<App, TContext, any, any>;

  // ── Serialization helpers ────────────────────────────────────────────────

  /**
   * Node names whose packet.data is the Session object.
   * The base deserializePacketData returns the live session for these nodes.
   * Override in subclasses that have Session-carrying nodes.
   */
  protected sessionCarryingNodes(): string[] {
    return [];
  }

  /**
   * Serialize packet data for checkpoint storage.
   * Default: Session objects → null (reconstructed from DB), everything else as-is.
   */
  serializePacketData(_nodeName: string, data: unknown): unknown {
    if (data instanceof Session) return null;
    if (data === undefined) return null;
    return data;
  }

  /**
   * Deserialize stored checkpoint data back to what the node expects.
   * Default: nodes in sessionCarryingNodes() → live session, everything else → stored data.
   */
  deserializePacketData(nodeName: string, data: unknown, session: Session): unknown {
    if (this.sessionCarryingNodes().includes(nodeName)) return session;
    return data ?? undefined;
  }

  // ── Execution ────────────────────────────────────────────────────────────

  /**
   * Fresh start — creates session, builds context, runs from the beginning.
   * Sets flow, session, promise on this instance.
   */
  async start(app: App, flowContext: FlowContext, params: TParameters): Promise<void> {
    this.session = await this.createSession(app, flowContext, params);
    const context = await this.createContext(app, flowContext, this.session, params);
    this.flow = this.createFlow();
    const startPacket = this._buildStartPacket(params, context, app);
    this.promise = this.flow.run(startPacket);
  }

  /**
   * Restore — uses existing session, reconstructs context, runs from checkpoint.
   * Sets flow, session, promise on this instance.
   */
  async restore(app: App, session: Session, user: User): Promise<void> {
    const { currentNodeName, currentPacketData } = session.sessionData as any;

    if (!currentNodeName) {
      throw new Error(`[FlowRunner.restore] Session '${session.id}' has no currentNodeName checkpoint`);
    }

    this.session = session;
    const flowContext: FlowContext = { user };
    const context = await this.createContext(app, flowContext, session, {} as TParameters);
    this.flow = this.createFlow();

    const node = this.flow.getNodeByName(currentNodeName);
    if (!node) {
      throw new Error(
        `[FlowRunner.restore] Node '${currentNodeName}' not found in flow '${this.flowName}'`,
      );
    }

    const data = this.deserializePacketData(currentNodeName, currentPacketData, session);
    const resumePacket: SinglePacket<any, App, TContext> = { data, context, deps: app };
    this.promise = this.flow.runFrom(node, resumePacket);
  }

  /**
   * Build the initial packet for a fresh run.
   * Subclasses may override if the start node needs different data than params.
   */
  protected _buildStartPacket(
    params: TParameters,
    context: TContext,
    app: App,
  ): SinglePacket<any, App, TContext> {
    return { data: params, context, deps: app };
  }
}
