import { createReminderFlow } from './reminder/flow.js';
export class Flows {
    createReminderFlow;
    cache;
    constructor(app) {
        this.createReminderFlow = createReminderFlow;
        this.cache = {};
    }
}
