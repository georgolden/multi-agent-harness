import { Bus } from './bus.js';
import { Pg, config as pgConfig } from './pg.js';
import type { App } from '../app.js';

export class Infra {
  bus: Bus;
  pg: Pg;

  constructor(app: App) {
    this.bus = new Bus();
    this.pg = new Pg(pgConfig);
  }

  async start() {
    await this.pg.start();
  }

  async stop() {
    await this.pg.stop();
  }
}
