import type { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import type { App } from '../../app.js';
import type { AgentSessionData, AgentStatus, CreateAgentSessionParams } from './types.js';

/** Any Prisma client or interactive-transaction client */
type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

interface AgentTxState {
  tx: TxClient;
  commit: () => void;
  rollback: (err: unknown) => void;
}

export class AgentSessionRepository {
  private prisma: PrismaClient;
  private _txMap = new Map<string, AgentTxState>();

  constructor(app: App) {
    this.prisma = app.infra.prisma.client;
  }

  private _client(agentSessionId: string): TxClient | PrismaClient {
    return (this._txMap.get(agentSessionId)?.tx ?? this.prisma) as any;
  }

  // ─── Transaction guard ────────────────────────────────────────────────────

  async beginTransaction(agentSessionId: string): Promise<void> {
    if (this._txMap.has(agentSessionId)) return;
    await new Promise<void>((outerResolve, outerReject) => {
      this.prisma
        .$transaction((tx) => {
          this._txMap.set(agentSessionId, {
            tx: tx as TxClient,
            commit: null!,
            rollback: null!,
          });
          outerResolve();
          return new Promise<void>((commit, rollback) => {
            const state = this._txMap.get(agentSessionId)!;
            state.commit = commit;
            state.rollback = rollback;
          });
        })
        .catch((err) => {
          this._txMap.delete(agentSessionId);
          outerReject(err);
        });
    });
  }

  async commitTransaction(agentSessionId: string, currentFlowName: string, currentFlowInput: unknown): Promise<void> {
    const state = this._txMap.get(agentSessionId);
    if (!state) return;
    await (state.tx as any).agentSession.update({
      where: { id: agentSessionId },
      data: { currentFlowName, currentFlowInput: currentFlowInput as any },
    });
    this._txMap.delete(agentSessionId);
    state.commit();
  }

  async rollbackTransaction(agentSessionId: string): Promise<void> {
    const state = this._txMap.get(agentSessionId);
    if (!state) return;
    this._txMap.delete(agentSessionId);
    state.rollback(new Error('Agent transaction rolled back'));
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  private mapRow(row: any): AgentSessionData {
    return {
      id: row.id,
      userId: row.userId,
      agentName: row.agentName,
      agentSchema: row.agentSchema,
      status: row.status as AgentStatus,
      currentFlowName: row.currentFlowName ?? undefined,
      currentFlowInput: row.currentFlowInput ?? undefined,
      startedAt: row.startedAt,
      endedAt: row.endedAt ?? undefined,
    };
  }

  generateId(): string {
    return randomBytes(8).toString('hex');
  }

  async create(params: CreateAgentSessionParams): Promise<AgentSessionData> {
    const id = params.id ?? this.generateId();
    const row = await this.prisma.agentSession.create({
      data: {
        id,
        userId: params.userId,
        agentName: params.agentName,
        agentSchema: params.agentSchema as any,
        status: 'running',
      },
    });
    return this.mapRow(row);
  }

  async updateCurrent(agentSessionId: string, currentFlowName: string, currentFlowInput: unknown): Promise<void> {
    const client = this._client(agentSessionId) as any;
    await client.agentSession.update({
      where: { id: agentSessionId },
      data: { currentFlowName, currentFlowInput: currentFlowInput as any },
    });
  }

  async updateStatus(agentSessionId: string, status: AgentStatus): Promise<void> {
    const client = this._client(agentSessionId) as any;
    await client.agentSession.update({
      where: { id: agentSessionId },
      data: {
        status,
        ...(status === 'completed' || status === 'failed' ? { endedAt: new Date() } : {}),
      },
    });
  }

  async getById(agentSessionId: string): Promise<AgentSessionData | null> {
    const row = await this.prisma.agentSession.findUnique({ where: { id: agentSessionId } });
    return row ? this.mapRow(row) : null;
  }

  async getByUserId(userId: string, status?: AgentStatus): Promise<AgentSessionData[]> {
    const rows = await this.prisma.agentSession.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { startedAt: 'desc' },
    });
    return rows.map((r) => this.mapRow(r));
  }

  async start(): Promise<void> {
    console.log('[AgentSessionRepository] Ready');
  }

  async stop(): Promise<void> {}
}
