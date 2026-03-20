import { Bus } from './bus.js';
import { Pg, config as pgConfig } from './pg.js';
import { PrismaService } from './prisma.js';
import type { App } from '../app.js';

export class Infra {
  bus: Bus;
  pg: Pg;
  prisma: PrismaService;

  constructor(_app: App) {
    this.bus = new Bus();
    this.pg = new Pg(pgConfig);
    this.prisma = new PrismaService(this.pg.pool);
  }

  async start() {
    await this.pg.start();
    await this.prisma.start();
  }

  async stop() {
    await this.prisma.stop();
    await this.pg.stop();
  }
}
