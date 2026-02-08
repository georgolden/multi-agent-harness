import { Bus } from './bus.js';
export class Infra {
    bus;
    constructor(app) {
        this.bus = new Bus();
    }
    async start() { }
    async stop() { }
}
