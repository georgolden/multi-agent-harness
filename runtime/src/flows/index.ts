import type { TSchema } from '@sinclair/typebox';
import { App } from '../app.js';
import { taskSchedulerFlow } from './taskScheduler/flow.js';
import { fillTemplateFlow } from './fillTemplate/flow.js';

type AgentFlow = {
  name: string;
  description: string;
  parameters: TSchema;
  create: () => any;
};

export class Flows {
  flows: { [key: string]: AgentFlow } = {
    reminder: taskSchedulerFlow,
    fillTemplate: fillTemplateFlow,
  };
  app: App;

  constructor(app: App) {
    this.app = app;
  }
}
