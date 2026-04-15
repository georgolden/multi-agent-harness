import type { PrismaClient } from '@prisma/client';
import type { App } from '../../app.js';
import type { UserToolkitData } from './types.js';

export class UserToolkitRepository {
  private prisma: PrismaClient;

  constructor(app: App) {
    this.prisma = app.infra.prisma.client;
  }

  async start(): Promise<void> {
    console.log('[UserToolkitRepository] Ready');
  }

  async stop(): Promise<void> {}

  async saveToolkit(params: {
    userId: string;
    provider: string;
    toolkitSlug: string;
    name: string;
    description: string;
    logo: string;
    categories: string[];
    providerData: Record<string, unknown>;
    status?: string;
  }): Promise<UserToolkitData> {
    const toolkit = await this.prisma.userToolkit.upsert({
      where: {
        uq_user_toolkit: {
          userId: params.userId,
          provider: params.provider,
          toolkitSlug: params.toolkitSlug,
        },
      },
      create: {
        userId: params.userId,
        provider: params.provider,
        toolkitSlug: params.toolkitSlug,
        name: params.name,
        description: params.description,
        logo: params.logo,
        categories: params.categories,
        providerData: params.providerData as any,
        status: params.status ?? 'active',
      },
      update: {
        name: params.name,
        description: params.description,
        logo: params.logo,
        categories: params.categories,
        providerData: params.providerData as any,
        status: params.status ?? 'active',
      },
    });

    return toolkit as unknown as UserToolkitData;
  }

  async getToolkits(userId: string): Promise<UserToolkitData[]> {
    const toolkits = await this.prisma.userToolkit.findMany({
      where: { userId },
      orderBy: { connectedAt: 'asc' },
    });
    return toolkits as unknown as UserToolkitData[];
  }

  async getToolkit(params: {
    userId: string;
    provider: string;
    toolkitSlug: string;
  }): Promise<UserToolkitData | null> {
    const toolkit = await this.prisma.userToolkit.findUnique({
      where: {
        uq_user_toolkit: {
          userId: params.userId,
          provider: params.provider,
          toolkitSlug: params.toolkitSlug,
        },
      },
    });
    return toolkit as unknown as UserToolkitData | null;
  }

  async deleteToolkit(id: string): Promise<void> {
    await this.prisma.userToolkit.delete({ where: { id } });
    console.log(`[UserToolkitRepository] Deleted toolkit ${id}`);
  }
}
