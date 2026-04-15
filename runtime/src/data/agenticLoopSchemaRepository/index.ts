import type { PrismaClient } from '@prisma/client';
import type { AgenticLoopSchema } from '../../agents/agentictLoop/flow.js';
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
    const schema = {
      userId: row.userId ?? undefined,
      name: row.name,
      description: row.description,
      userPromptTemplate: row.userPromptTemplate ?? undefined,
      systemPrompt: row.systemPrompt,
      toolNames: row.toolNames,
      skillNames: row.skillNames,
      toolkitSlugs: row.toolkitSlugs ?? [],
      contextPaths: row.contextPaths as any,
      callLlmOptions: row.callLlmOptions as any,
      messageWindowConfig: row.messageWindowConfig as any,
      agentLoopConfig: row.agentLoopConfig as any,
    };
    console.log(`[AgenticLoopSchemaRepository.mapRow] name='${schema.name}' toolNames=${JSON.stringify(schema.toolNames)} skillNames=${JSON.stringify(schema.skillNames)} agentLoopConfig=${JSON.stringify(schema.agentLoopConfig)} contextPaths=${JSON.stringify(schema.contextPaths)} callLlmOptions=${JSON.stringify(schema.callLlmOptions)} messageWindowConfig=${JSON.stringify(schema.messageWindowConfig)}`);
    return schema;
  }

  async createSchema(params: { userId?: string; schema: AgenticLoopSchema }): Promise<StoredAgenticLoopSchema> {
    const row = await this.prisma.agenticLoopSchema.create({
      data: {
        name: params.schema.name,
        userId: params.userId ?? null,
        description: params.schema.description,
        userPromptTemplate: params.schema.userPromptTemplate ?? null,
        systemPrompt: params.schema.systemPrompt,
        toolNames: params.schema.toolNames,
        skillNames: params.schema.skillNames,
        toolkitSlugs: params.schema.toolkitSlugs ?? [],
        contextPaths: params.schema.contextPaths as any,
        callLlmOptions: params.schema.callLlmOptions as any,
        messageWindowConfig: params.schema.messageWindowConfig as any,
        agentLoopConfig: params.schema.agentLoopConfig as any,
      },
    });
    const schema = this.mapRow(row);
    console.log(`[AgenticLoopSchemaRepository] Created schema '${params.schema.name}'`);
    if (this.hooks.onInsert) await this.hooks.onInsert(schema);
    return schema;
  }

  async getSchema(name: string): Promise<StoredAgenticLoopSchema | null> {
    const row = await this.prisma.agenticLoopSchema.findUnique({ where: { name } });
    return row ? this.mapRow(row) : null;
  }

  async getSchemaForUser(name: string, userId: string): Promise<StoredAgenticLoopSchema | null> {
    const row = await this.prisma.agenticLoopSchema.findFirst({ where: { name, userId } });
    return row ? this.mapRow(row) : null;
  }

  async getAllSchemasForUser(userId: string): Promise<StoredAgenticLoopSchema[]> {
    const rows = await this.prisma.agenticLoopSchema.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.mapRow(r));
  }

  async getAllSchemas(): Promise<StoredAgenticLoopSchema[]> {
    const rows = await this.prisma.agenticLoopSchema.findMany({ orderBy: { name: 'asc' } });
    return rows.map((r) => this.mapRow(r));
  }

  async updateSchema(name: string, params: Partial<AgenticLoopSchema>): Promise<StoredAgenticLoopSchema | null> {
    const data: Record<string, any> = {};
    if (params.description !== undefined) data.description = params.description;
    if (params.userPromptTemplate !== undefined) data.userPromptTemplate = params.userPromptTemplate ?? null;
    if (params.systemPrompt !== undefined) data.systemPrompt = params.systemPrompt;
    if (params.toolNames !== undefined) data.toolNames = params.toolNames;
    if (params.skillNames !== undefined) data.skillNames = params.skillNames;
    if (params.toolkitSlugs !== undefined) data.toolkitSlugs = params.toolkitSlugs;
    if (params.contextPaths !== undefined) data.contextPaths = params.contextPaths as any;
    if (params.callLlmOptions !== undefined) data.callLlmOptions = params.callLlmOptions as any;
    if (params.messageWindowConfig !== undefined) data.messageWindowConfig = params.messageWindowConfig as any;
    if (params.agentLoopConfig !== undefined) data.agentLoopConfig = params.agentLoopConfig as any;

    if (Object.keys(data).length === 0) return this.getSchema(name);

    try {
      const row = await this.prisma.agenticLoopSchema.update({ where: { name }, data });
      const schema = this.mapRow(row);
      console.log(`[AgenticLoopSchemaRepository] Updated schema '${name}'`);
      if (this.hooks.onUpdate) await this.hooks.onUpdate(schema);
      return schema;
    } catch {
      console.log(`[AgenticLoopSchemaRepository] Schema '${name}' not found`);
      return null;
    }
  }

  async deleteSchema(name: string): Promise<boolean> {
    try {
      await this.prisma.agenticLoopSchema.delete({ where: { name } });
      console.log(`[AgenticLoopSchemaRepository] Deleted schema '${name}'`);
      if (this.hooks.onDelete) await this.hooks.onDelete(name);
      return true;
    } catch {
      console.log(`[AgenticLoopSchemaRepository] Schema '${name}' not found`);
      return false;
    }
  }

  async deleteSchemaForUser(name: string, userId: string): Promise<boolean> {
    const deleted = await this.prisma.agenticLoopSchema.deleteMany({ where: { name, userId } });
    if (deleted.count === 0) {
      console.log(`[AgenticLoopSchemaRepository] Schema '${name}' not found for user ${userId}`);
      return false;
    }
    console.log(`[AgenticLoopSchemaRepository] Deleted schema '${name}' for user ${userId}`);
    if (this.hooks.onDelete) await this.hooks.onDelete(name);
    return true;
  }
}
