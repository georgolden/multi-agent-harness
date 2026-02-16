// Core domain types
export interface Task {
  id: string;
  userId: string;
  taskName: string;
  parameters: Record<string, any>;
  scheduleType: 'once' | 'cron';
  scheduleValue: string; // ISO datetime or cron expression
  startDate?: Date;
  endDate?: Date;
  timezone: string;
  createdAt: Date;
  active: boolean;
}
