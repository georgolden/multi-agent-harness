import { App } from '../app.js';
import { TSchema, Type } from '@sinclair/typebox';

// ─── Task Handlers ───────────────────────────────────────────────────────────

/**
 * Reminder task handler
 * Sends a reminder message to the user via the event bus
 */
async function reminder(app: App, { userId, message }: { userId: string; message: string }) {
  app.infra.bus.emit('reminder', { userId, message: `⏰ reminder: ${message}` });
}

/**
 * RunAgentFlow task handler
 * Runs a specified agent flow (builtin or schema-based) with the provided message
 *
 * Note: Scheduled task execution does not yet support user context, which is required
 * for flow execution. This is a placeholder that validates the agent exists and logs
 * execution intent. Future implementation should store and pass user context.
 */
async function runAgentFlow(
  app: App,
  { agentType, flowName, userId: _userId, message: _message }: { agentType: string; flowName: string; userId: string; message: string },
) {
  try {
    if (agentType === 'builtin') {
      // Find and validate built-in flow
      const allFlows = app.flows.getFlows();
      const flow = allFlows.find((f) => f.name === flowName);

      if (!flow) {
        const availableFlows = allFlows.map((f) => f.name);
        console.error(
          `[runAgentFlow] Built-in flow "${flowName}" not found. Available: ${availableFlows.join(', ') || 'none'}`,
        );
        return;
      }

      console.log(`[runAgentFlow] Executing builtin flow: ${flowName}`);
    } else if (agentType === 'schema') {
      // Run schema-based agentic loop
      const schema = app.flows.getSchemaAgent(flowName);

      if (!schema) {
        const availableSchemas = app.flows.getAgenticLoopSchemas();
        console.error(
          `[runAgentFlow] Schema agent "${flowName}" not found. Available: ${availableSchemas.map((s) => s.flowName).join(', ') || 'none'}`,
        );
        return;
      }

      console.log(`[runAgentFlow] Executing schema agent: ${flowName}`);
    } else {
      console.error(`[runAgentFlow] Invalid agentType: "${agentType}". Must be "builtin" or "schema"`);
    }
  } catch (error) {
    console.error(`[runAgentFlow] Error running agent flow "${flowName}":`, error);
  }
}

// ─── Task Definitions ────────────────────────────────────────────────────────

type Task = {
  name: string;
  parameters: TSchema;
  description: string;
  run: (app: App, args: any) => Promise<void>;
};

const TASK_REGISTRY: Record<string, Task> = {
  reminder: {
    name: 'reminder',
    description: 'Used to send a reminder to a user',
    parameters: Type.Object({
      userId: Type.String({ description: 'ID of the user to send the reminder to' }),
      message: Type.String({ description: 'The reminder message' }),
    }),
    run: reminder,
  },
  runAgentFlow: {
    name: 'runAgentFlow',
    description: 'Used to run a specific agentic flow - either builtin or schema-based',
    parameters: Type.Object({
      agentType: Type.String({
        enum: ['builtin', 'schema'],
        description: 'Type of agent: "builtin" for predefined flows, "schema" for stored schema agents',
      }),
      flowName: Type.String({ description: 'Name of the agent flow or schema to execute' }),
      userId: Type.String({ description: 'ID of the user requesting the flow' }),
      message: Type.String({ description: 'Input message to send to the agent flow' }),
    }),
    run: runAgentFlow,
  },
};

// ─── Tasks Class ────────────────────────────────────────────────────────────

export class Tasks {
  app: App;
  tasks: Record<string, Task>;

  constructor(app: App) {
    this.app = app;
    this.tasks = TASK_REGISTRY;
  }

  /**
   * Run a task by name with the provided arguments
   */
  async runTask(taskName: string, args: any) {
    const task = this.tasks[taskName];
    if (!task) {
      console.error(`[Tasks.runTask] Unknown task: ${taskName}`);
      return;
    }

    try {
      await task.run(this.app, args);
    } catch (error) {
      console.error(`[Tasks.runTask] Error running task "${taskName}":`, error);
    }
  }

  /**
   * Get a formatted string representation of available tasks and their schemas
   */
  getTasksSchema(): string {
    return JSON.stringify(this.tasks, null, 2);
  }

  /**
   * Get all available task names
   */
  getAvailableTasks(): string[] {
    return Object.keys(this.tasks);
  }

  /**
   * Check if a task exists
   */
  hasTask(taskName: string): boolean {
    return taskName in this.tasks;
  }

  /**
   * Get a specific task definition
   */
  getTask(taskName: string): Task | undefined {
    return this.tasks[taskName];
  }
}
