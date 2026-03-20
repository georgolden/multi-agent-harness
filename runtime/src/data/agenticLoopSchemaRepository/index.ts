import type { PrismaClient } from '@prisma/client';
import type { AgenticLoopSchema } from '../../flows/agentictLoop/flow.js';
import type { StoredAgenticLoopSchema, RepositoryHook } from './types.js';
import type { App } from '../../app.js';

export class AgenticLoopSchemaRepository {
  private prisma: PrismaClient;
  app: App;
  private hooks: RepositoryHook = {};

  constructor(app: App) {
    this.app = app;
    this.prisma = app.infra.prisma.client;
  }

  registerHooks(hooks: RepositoryHook): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  async start(): Promise<void> {
    console.log('[AgenticLoopSchemaRepository] Ready');
  }

  async stop(): Promise<void> {}

  private mapRow(row: any): StoredAgenticLoopSchema {
    return {
      userId: row.userId ?? undefined,
      flowName: row.flowName,
      description: row.description,
      userPromptTemplate: row.userPromptTemplate ?? undefined,
      systemPrompt: row.systemPrompt,
      toolNames: row.toolNames,
      skillNames: row.skillNames,
      contextPaths: row.contextPaths as any,
      callLlmOptions: row.callLlmOptions as any,
      messageWindowConfig: row.messageWindowConfig as any,
      agentLoopConfig: row.agentLoopConfig as any,
    };
  }

  async createSchema(params: { userId?: string; schema: AgenticLoopSchema }): Promise<StoredAgenticLoopSchema> {
    const row = await this.prisma.agenticLoopSchema.create({
      data: {
        flowName: params.schema.flowName,
        userId: params.userId ?? null,
        description: params.schema.description,
        userPromptTemplate: params.schema.userPromptTemplate ?? null,
        systemPrompt: params.schema.systemPrompt,
        toolNames: params.schema.toolNames,
        skillNames: params.schema.skillNames,
        contextPaths: params.schema.contextPaths as any,
        callLlmOptions: params.schema.callLlmOptions as any,
        messageWindowConfig: params.schema.messageWindowConfig as any,
        agentLoopConfig: params.schema.agentLoopConfig as any,
      },
    });
    const schema = this.mapRow(row);
    console.log(`[AgenticLoopSchemaRepository] Created schema '${params.schema.flowName}'`);
    if (this.hooks.onInsert) await this.hooks.onInsert(schema);
    return schema;
  }

  async getSchema(flowName: string): Promise<StoredAgenticLoopSchema | null> {
    const row = await this.prisma.agenticLoopSchema.findUnique({ where: { flowName } });
    return row ? this.mapRow(row) : null;
  }

  async getSchemaForUser(flowName: string, userId: string): Promise<StoredAgenticLoopSchema | null> {
    const row = await this.prisma.agenticLoopSchema.findFirst({ where: { flowName, userId } });
    return row ? this.mapRow(row) : null;
  }

  async getAllSchemasForUser(userId: string): Promise<StoredAgenticLoopSchema[]> {
    const rows = await this.prisma.agenticLoopSchema.findMany({
      where: { userId },
      orderBy: { flowName: 'asc' },
    });
    return rows.map((r) => this.mapRow(r));
  }

  async getAllSchemas(): Promise<StoredAgenticLoopSchema[]> {
    const rows = await this.prisma.agenticLoopSchema.findMany({ orderBy: { flowName: 'asc' } });
    return rows.map((r) => this.mapRow(r));
  }

  async updateSchema(flowName: string, params: Partial<AgenticLoopSchema>): Promise<StoredAgenticLoopSchema | null> {
    const data: Record<string, any> = {};
    if (params.description !== undefined) data.description = params.description;
    if (params.userPromptTemplate !== undefined) data.userPromptTemplate = params.userPromptTemplate ?? null;
    if (params.systemPrompt !== undefined) data.systemPrompt = params.systemPrompt;
    if (params.toolNames !== undefined) data.toolNames = params.toolNames;
    if (params.skillNames !== undefined) data.skillNames = params.skillNames;
    if (params.contextPaths !== undefined) data.contextPaths = params.contextPaths as any;
    if (params.callLlmOptions !== undefined) data.callLlmOptions = params.callLlmOptions as any;
    if (params.messageWindowConfig !== undefined) data.messageWindowConfig = params.messageWindowConfig as any;
    if (params.agentLoopConfig !== undefined) data.agentLoopConfig = params.agentLoopConfig as any;

    if (Object.keys(data).length === 0) return this.getSchema(flowName);

    try {
      const row = await this.prisma.agenticLoopSchema.update({ where: { flowName }, data });
      const schema = this.mapRow(row);
      console.log(`[AgenticLoopSchemaRepository] Updated schema '${flowName}'`);
      if (this.hooks.onUpdate) await this.hooks.onUpdate(schema);
      return schema;
    } catch {
      console.log(`[AgenticLoopSchemaRepository] Schema '${flowName}' not found`);
      return null;
    }
  }

  async deleteSchema(flowName: string): Promise<boolean> {
    try {
      await this.prisma.agenticLoopSchema.delete({ where: { flowName } });
      console.log(`[AgenticLoopSchemaRepository] Deleted schema '${flowName}'`);
      if (this.hooks.onDelete) await this.hooks.onDelete(flowName);
      return true;
    } catch {
      console.log(`[AgenticLoopSchemaRepository] Schema '${flowName}' not found`);
      return false;
    }
  }

  async deleteSchemaForUser(flowName: string, userId: string): Promise<boolean> {
    const deleted = await this.prisma.agenticLoopSchema.deleteMany({ where: { flowName, userId } });
    if (deleted.count === 0) {
      console.log(`[AgenticLoopSchemaRepository] Schema '${flowName}' not found for user ${userId}`);
      return false;
    }
    console.log(`[AgenticLoopSchemaRepository] Deleted schema '${flowName}' for user ${userId}`);
    if (this.hooks.onDelete) await this.hooks.onDelete(flowName);
    return true;
  }
}
