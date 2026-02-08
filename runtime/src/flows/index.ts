import { App } from '../app.js';
import { createReminderFlow } from './reminder/flow.js';

export class Flows {
  createReminderFlow: typeof createReminderFlow;
  cache: Record<string, any>;

  constructor(app: App) {
    this.createReminderFlow = createReminderFlow;
    this.cache = {};
  }
}
