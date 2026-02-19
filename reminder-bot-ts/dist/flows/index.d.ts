import { App } from '../app.js';
import { createReminderFlow } from './reminder/flow.js';
import { createTimezoneFlow } from './timezone/flow.js';
export declare class Flows {
    createReminderFlow: typeof createReminderFlow;
    createTimezoneFlow: typeof createTimezoneFlow;
    cache: Record<string, any>;
    constructor(app: App);
}
