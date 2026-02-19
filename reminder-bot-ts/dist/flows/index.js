import { createReminderFlow } from './reminder/flow.js';
import { createTimezoneFlow } from './timezone/flow.js';
export class Flows {
    createReminderFlow;
    createTimezoneFlow;
    cache;
    constructor(app) {
        this.createReminderFlow = createReminderFlow;
        this.createTimezoneFlow = createTimezoneFlow;
        this.cache = {};
    }
}
