// Core domain types
export interface Reminder {
  id: string;
  userId: string;
  chatId: string;
  text: string;
  scheduleType: 'once' | 'cron';
  scheduleValue: string; // ISO datetime or cron expression
  startDate?: Date;
  endDate?: Date;
  timezone: string;
  createdAt: Date;
  active: boolean;
}
