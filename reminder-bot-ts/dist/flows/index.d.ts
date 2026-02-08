import { App } from '../app.js';
import { createReminderFlow } from './reminder/flow.js';
export declare class Flows {
    createReminderFlow: typeof createReminderFlow;
    cache: Record<string, any>;
    constructor(app: App);
}
