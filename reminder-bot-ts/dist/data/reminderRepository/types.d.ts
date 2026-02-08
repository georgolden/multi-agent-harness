export interface Reminder {
    id: string;
    userId: string;
    chatId: string;
    text: string;
    scheduleType: 'once' | 'cron';
    scheduleValue: string;
    startDate?: Date;
    endDate?: Date;
    timezone: string;
    createdAt: Date;
    active: boolean;
}
export interface User {
    id: string;
    timezone: string;
}
