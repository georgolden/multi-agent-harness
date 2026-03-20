import type { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import type { Task } from './types.js';
import type { App } from '../../app.js';

export class TaskRepository {
  private prisma: PrismaClient;

  constructor(app: App) {
    this.prisma = app.infra.prisma.client;
  }

  async start(): Promise<void> {
    console.log('[TaskRepository] Ready');
  }

  async stop(): Promise<void> {}

  generateTaskId(): string {
    return randomBytes(4).toString('hex');
  }

  private mapRow(row: any): Task {
    return {
      id: row.id,
      userId: row.userId,
      taskName: row.taskName,
      parameters: row.parameters as Record<string, any>,
      scheduleType: row.scheduleType as 'once' | 'cron',
      scheduleValue: row.scheduleValue,
      startDate: row.startDate ?? undefined,
      endDate: row.endDate ?? undefined,
      timezone: row.timezone,
      createdAt: row.createdAt,
      active: row.active,
    };
  }

  async saveTask(params: {
    userId: string;
    taskName: string;
    parameters: Record<string, any>;
    scheduleType: 'once' | 'cron';
    scheduleValue: string;
    startDate?: Date;
    endDate?: Date;
    timezone: string;
    taskId?: string;
  }): Promise<Task> {
    const id = params.taskId ?? this.generateTaskId();
    const row = await this.prisma.task.create({
      data: {
        id,
        userId: params.userId,
        chatId: '',
        taskName: params.taskName,
        parameters: params.parameters,
        scheduleType: params.scheduleType,
        scheduleValue: params.scheduleValue,
        startDate: params.startDate,
        endDate: params.endDate,
        timezone: params.timezone,
      },
    });
    console.log(`[TaskRepository] Saved task '${id}': ${params.taskName}`);
    return this.mapRow(row);
  }

  async getTasks(userId: string): Promise<Task[]> {
    const rows = await this.prisma.task.findMany({
      where: { userId, active: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.mapRow(r));
  }

  async getTask(taskId: string): Promise<Task | null> {
    const row = await this.prisma.task.findUnique({ where: { id: taskId } });
    return row ? this.mapRow(row) : null;
  }

  async getTaskForUser(taskId: string, userId: string): Promise<Task | null> {
    const row = await this.prisma.task.findFirst({ where: { id: taskId, userId, active: true } });
    return row ? this.mapRow(row) : null;
  }

  async getAllTasks(): Promise<Task[]> {
    const rows = await this.prisma.task.findMany({ where: { active: true } });
    return rows.map((r) => this.mapRow(r));
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const updated = await this.prisma.task.updateMany({
      where: { id: taskId },
      data: { active: false },
    });
    if (updated.count === 0) {
      console.log(`[TaskRepository] Task '${taskId}' not found`);
      return false;
    }
    console.log(`[TaskRepository] Deleted task '${taskId}'`);
    return true;
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
    console.log(`[TaskRepository] Set timezone for user ${userId}: ${timezone}`);
  }
}
