import type { Flow } from 'pocketflow';
import type { TSchema } from '@sinclair/typebox';
import { App } from '../app.js';
import { taskSchedulerFlow } from './taskScheduler/flow.js';

type AgentFlow = {
  name: string;
  description: string;
  parameters: TSchema;
  create: () => Flow;
};

export class Flows {
  flows: { [key: string]: AgentFlow } = {
    reminder: taskSchedulerFlow,
  };
  app: App;

  constructor(app: App) {
    this.app = app;
  }
}
