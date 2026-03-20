import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool } from 'pg';

export class PrismaService {
  client: PrismaClient;

  constructor(pool: Pool) {
    const adapter = new PrismaPg(pool);
    this.client = new PrismaClient({ adapter });
  }

  async start(): Promise<void> {
    await this.client.$connect();
    console.log('[PrismaService] Connected');
  }

  async stop(): Promise<void> {
    // Pool lifecycle is owned by Pg — do not call $disconnect here
    console.log('[PrismaService] Stopped');
  }
}
