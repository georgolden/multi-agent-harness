import type { PrismaClient } from '@prisma/client';
import type { User } from './types.js';
import type { App } from '../../app.js';

export class UserRepository {
  private prisma: PrismaClient;

  constructor(app: App) {
    this.prisma = app.infra.prisma.client;
  }

  async start(): Promise<void> {
    console.log('[UserRepository] Ready');
  }

  async stop(): Promise<void> {}

  async getUser(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } }) as Promise<User | null>;
  }

  async getUserTimezone(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
    if (!user) {
      await this.prisma.user.create({ data: { id: userId, timezone: 'UTC' } });
      return 'UTC';
    }
    return user.timezone;
  }

  async setUserTimezone(userId: string, timezone: string): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, timezone },
      update: { timezone },
    });
    console.log(`[UserRepository] Set timezone for user ${userId}: ${timezone}`);
  }

  async saveUser(params: { userId: string; name?: string; timezone?: string }): Promise<User> {
    const user = await this.prisma.user.upsert({
      where: { id: params.userId },
      create: { id: params.userId, name: params.name, timezone: params.timezone ?? 'UTC' },
      update: {
        name: params.name ?? undefined,
        timezone: params.timezone ?? undefined,
      },
    });
    console.log(`[UserRepository] Saved user '${params.userId}'`);
    return user as User;
  }

  async getAllUsers(): Promise<User[]> {
    return this.prisma.user.findMany({ orderBy: { id: 'asc' } }) as Promise<User[]>;
  }

  async deleteUser(userId: string): Promise<boolean> {
    try {
      await this.prisma.user.delete({ where: { id: userId } });
      console.log(`[UserRepository] Deleted user '${userId}'`);
      return true;
    } catch {
      console.log(`[UserRepository] User '${userId}' not found`);
      return false;
    }
  }
}
