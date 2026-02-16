/**
 * PostgreSQL connection pool manager
 * Provides a single shared pool for all repositories
 */
import { Pool } from 'pg';

export class Pg {
  public pool: Pool;

  constructor({ connectionString }: { connectionString: string }) {
    this.pool = new Pool({ connectionString });
  }

  async start(): Promise<void> {
    // Test connection
    const client = await this.pool.connect();
    client.release();
    console.log('[Pg] Database connection pool initialized');
  }

  async stop(): Promise<void> {
    await this.pool.end();
    console.log('[Pg] Database connection pool closed');
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error('Env DATABASE_URL is not defined');
}

export const config = {
  connectionString: process.env.DATABASE_URL,
};
