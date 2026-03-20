import type { PrismaClient } from '@prisma/client';
import type { App } from '../../app.js';
import type { FlowRunRecord, FlowRunStatus } from '../../flows/types.js';
import { randomBytes } from 'node:crypto';

function generateRunId(): string {
  return randomBytes(4).toString('hex');
}

function mapRow(row: any): FlowRunRecord {
  return {
    id: row.id,
    flowName: row.flowName,
    sessionId: row.sessionId,
    userId: row.userId,
    status: row.status as FlowRunStatus,
    startedAt: new Date(row.startedAt),
    endedAt: row.endedAt ? new Date(row.endedAt) : undefined,
    parentSessionId: row.parentSessionId ?? undefined,
  };
}

export class FlowRunRepository {
  private prisma: PrismaClient;

  constructor(app: App) {
    this.prisma = app.infra.prisma.client;
  }

  async start(): Promise<void> {
    console.log('[FlowRunRepository] Ready');
  }

  async stop(): Promise<void> {}

  async createRun(params: {
    flowName: string;
    sessionId: string;
    userId: string;
    parentSessionId?: string;
  }): Promise<FlowRunRecord> {
    const row = await this.prisma.flowRun.create({
      data: {
        id: generateRunId(),
        flowName: params.flowName,
        sessionId: params.sessionId,
        userId: params.userId,
        parentSessionId: params.parentSessionId ?? null,
      },
    });
    return mapRow(row);
  }

  async updateStatus(id: string, status: FlowRunStatus): Promise<void> {
    const endedAt = status === 'completed' || status === 'failed' ? new Date() : null;
    await this.prisma.flowRun.update({
      where: { id },
      data: { status, ...(endedAt ? { endedAt } : {}) },
    });
  }

  async getActiveRuns(): Promise<FlowRunRecord[]> {
    const rows = await this.prisma.flowRun.findMany({
      where: { status: { in: ['running', 'paused'] } },
      orderBy: { startedAt: 'desc' },
    });
    return rows.map(mapRow);
  }

  async getRunsByUser(userId: string): Promise<FlowRunRecord[]> {
    const rows = await this.prisma.flowRun.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
    });
    return rows.map(mapRow);
  }

  async getRunBySessionId(sessionId: string): Promise<FlowRunRecord | null> {
    const row = await this.prisma.flowRun.findFirst({ where: { sessionId } });
    return row ? mapRow(row) : null;
  }
}
