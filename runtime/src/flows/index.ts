import { App } from '../app.js';
import { taskSchedulerFlow } from './taskScheduler/flow.js';
import { fillTemplateFlow } from './fillTemplate/flow.js';
import { exploreFlow } from './explore/flow.js';
import { agenticLoopFlow } from './agentictLoop/flow.js';
import { User } from '../data/userRepository/types.js';
import { Session } from '../services/sessionService/index.js';
import type { StoredAgenticLoopSchema } from '../data/agenticLoopSchemaRepository/types.js';

/**
 * Common context passed to all flow run functions
 */
export type FlowContext = {
  user: User;
  parent?: Session;
};

/**
 * Flow registry mapping flow names to their definitions
 */
export type FlowRegistry = {
  taskScheduler: typeof taskSchedulerFlow;
  fillTemplate: typeof fillTemplateFlow;
  explore: typeof exploreFlow;
  agenticLoop: typeof agenticLoopFlow;
};

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Flows manager class that provides access to all registered flows
 */
export class Flows {
  private flowRegistry: FlowRegistry = {
    taskScheduler: taskSchedulerFlow,
    fillTemplate: fillTemplateFlow,
    explore: exploreFlow,
    agenticLoop: agenticLoopFlow,
  };

  app: App;
  private agenticLoopSchemas: Map<string, StoredAgenticLoopSchema> = new Map();

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Initialize schemas from database and register hooks on startup
   */
  async start(): Promise<void> {
    const schemas = await this.app.data.agenticLoopSchemaRepository.getAllSchemas();
    schemas.forEach((schema) => {
      this.agenticLoopSchemas.set(schema.flowName, schema);
    });
    console.log(`[Flows] Loaded ${schemas.length} agentic loop schemas from database`);

    // Register hooks to keep schemas in sync
    this.app.data.agenticLoopSchemaRepository.registerHooks({
      onInsert: (schema) => {
        this.agenticLoopSchemas.set(schema.flowName, schema);
        console.log(`[Flows] Schema inserted: ${schema.flowName}`);
      },
      onUpdate: (schema) => {
        this.agenticLoopSchemas.set(schema.flowName, schema);
        console.log(`[Flows] Schema updated: ${schema.flowName}`);
      },
      onDelete: (flowName) => {
        this.agenticLoopSchemas.delete(flowName);
        console.log(`[Flows] Schema deleted: ${flowName}`);
      },
    });
  }

  /**
   * Get all stored agentic loop schemas
   */
  getAgenticLoopSchemas(): StoredAgenticLoopSchema[] {
    return Array.from(this.agenticLoopSchemas.values());
  }

  /**
   * Get a flow by name from the registry
   */
  getFlow<K extends keyof FlowRegistry>(name: K): FlowRegistry[K] | undefined {
    return this.flowRegistry[name];
  }

  /**
   * Get all flows
   */
  getFlows(): Array<FlowRegistry[keyof FlowRegistry]> {
    return Object.values(this.flowRegistry);
  }

  /**
   * Returns flows for the given flow names, skipping unknown names
   */
  getSlice(names: string[]): Array<FlowRegistry[keyof FlowRegistry]> {
    return names
      .map((name) => this.flowRegistry[name as keyof FlowRegistry])
      .filter((flow): flow is FlowRegistry[keyof FlowRegistry] => flow !== undefined);
  }

  /**
   * Returns flows as XML. If flowNames is provided, only returns those flows.
   * Otherwise returns all flows. Also includes schema agents from database.
   */
  getFlowsAsXml(flowNames?: string[]): string {
    // Filter flows if flowNames is provided
    const flowsToReturn = flowNames ? this.getSlice(flowNames) : Object.values(this.flowRegistry);

    const lines = ['<available_agents>'];

    // Add built-in flows
    for (const flow of flowsToReturn) {
      lines.push('  <agent>');
      lines.push(`    <name>${escapeXml(flow.name)}</name>`);
      lines.push(`    <description>${escapeXml(flow.description)}</description>`);
      lines.push('  </agent>');
    }

    // Add schema agents from database
    const schemas = this.getAgenticLoopSchemas();
    if (schemas.length > 0) {
      lines.push('  <schema_agents>');
      for (const schema of schemas) {
        lines.push('    <schema_agent>');
        lines.push(`      <name>${escapeXml(schema.flowName)}</name>`);
        lines.push(`      <description>${escapeXml(schema.description)}</description>`);
        lines.push('    </schema_agent>');
      }
      lines.push('  </schema_agents>');
    }

    lines.push('</available_agents>');

    return lines.join('\n');
  }

  /**
   * Type-safe run method with full parameter inference
   */
  async runFlow<K extends keyof FlowRegistry>(
    name: K,
    context: FlowContext,
    parameters: Parameters<FlowRegistry[K]['run']>[2],
  ): Promise<Awaited<ReturnType<FlowRegistry[K]['run']>>> {
    const flow = this.getFlow(name);
    if (!flow) {
      throw new Error(`Flow '${String(name)}' not found`);
    }
    return flow.run(this.app, context as never, parameters as never);
  }
}
