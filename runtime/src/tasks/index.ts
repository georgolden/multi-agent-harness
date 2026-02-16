import { Value } from '@sinclair/typebox/value';
import { App } from '../app.js';
import { TSchema, Type } from '@sinclair/typebox';

async function reminder(app: App, { userId, message }: { userId: string; message: string }) {
  app.infra.bus.emit('reminder', { userId, message: `⏰ reminder: ${message}` });
}

async function runAgentFlow(
  app: App,
  { flowName, userId, message }: { flowName: string; userId: string; message: string },
) {
  const agentFlow = app.flows.flows[flowName];
  if (!agentFlow) {
    console.error(`Unknown flow: ${flowName}`);
    return;
  }
  const flow = agentFlow.create();
  const context = { userId, message };
  const valid = Value.Check(agentFlow.parameters, context);
  if (!valid) {
    console.error(`Flow: ${flowName} can't be run with message and userId only requires: ${agentFlow.parameters}`);
    return;
  }
  const sharedStore = { app, context };
  await flow.run(sharedStore);
}

type Task = {
  name: string;
  parameters: TSchema;
  description: string;
  run: (app: App, args: any) => Promise<void>;
};

export class Tasks {
  app: App;
  tasks: Record<string, Task> = {
    reminder: {
      name: 'reminder',
      description: 'Used to send a reminder to a user',
      parameters: Type.Object({
        userId: Type.String(),
        message: Type.String(),
      }),
      run: reminder,
    },
    runAgentFlow: {
      name: 'runAgentFlow',
      description: 'Used to run a specific agentic task. HINT: flowName is specified',
      parameters: Type.Object({
        flowName: Type.String(),
        userId: Type.String(),
        message: Type.String(),
      }),
      run: runAgentFlow,
    },
  };

  constructor(app: App) {
    this.app = app;
  }

  async runTask(taskName: string, args: any) {
    const task = this.tasks[taskName];
    if (!task) {
      console.error(`Unknown task: ${taskName}`);
      return;
    }
    try {
      await task.run(this.app, args);
    } catch (error) {
      console.error(`Error running task ${taskName}:`, error);
    }
  }

  /**
   * Get a formatted string representation of available tasks and their schemas
   */
  getTasksSchema(): string {
    return JSON.stringify(this.tasks, null, 2);
  }
}
