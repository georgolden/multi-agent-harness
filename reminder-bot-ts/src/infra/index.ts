import { Bus } from './bus.js';
import type { App } from '../app.js';

export class Infra {
  bus: Bus;

  constructor(app: App) {
    this.bus = new Bus();
  }

  async start() {}

  async stop() {}
}
