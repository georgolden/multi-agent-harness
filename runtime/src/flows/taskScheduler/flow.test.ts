import { describe, it, expect, vi, beforeAll } from 'vitest';
import 'dotenv/config';
import { createTaskSchedulerFlow } from './flow.js';
import { App } from '../../app.js';
import { SharedStore } from '../../types.js';
import { TaskSchedulerContext } from './types.js';
import { MessageHistory } from '../../data/messageHistory/index.js';
import { Task } from '../../data/taskRepository/types.js';

// Helper to setup isolated app environment for each test
function setupTestApp() {
  const mockStorage = {
    getReminders: vi.fn(),
    getUserTimezone: vi.fn(),
    saveReminder: vi.fn(),
    deleteReminder: vi.fn(),
    getReminderForUser: vi.fn(),
    setUserTimezone: vi.fn(),
    getAllReminders: vi.fn(),
    getReminder: vi.fn(),
  };

  const mockScheduler = {
    scheduleReminder: vi.fn(),
    removeJob: vi.fn(),
    scheduleOnce: vi.fn(),
    scheduleCron: vi.fn(),
  };

  const mockBus = {
    emit: vi.fn(),
    on: vi.fn(),
  };

  const app = {
    data: {
      reminderRepository: mockStorage,
    },
    services: {
      scheduler: mockScheduler,
    },
    infra: {
      bus: mockBus,
    },
  } as unknown as App;

  const messageHistory = new MessageHistory(app, { maxMessages: 20 });
  app.data.messageHistory = messageHistory;

  // Default mock implementations
  mockStorage.getUserTimezone.mockResolvedValue('UTC');
  mockStorage.getReminders.mockResolvedValue([]);

  // Mock saveReminder to return what was passed with an ID
  mockStorage.saveReminder.mockImplementation(async (r: any) => ({
    ...r,
    id: 'test-reminder-id',
    created_at: new Date(),
    active: true,
  }));

  // Mock getReminderForUser for cancellation
  mockStorage.getReminderForUser.mockImplementation(async (id: string, userId: string) => ({
    id,
    userId,
    text: 'Test Reminder',
    scheduleType: 'once',
    scheduleValue: new Date().toISOString(),
    timezone: 'UTC',
    active: true,
  }));

  return { app, mockStorage, mockScheduler, mockBus, messageHistory };
}

describe('Reminder Flow Integration', () => {
  beforeAll(() => {
    if (!process.env.OPENROUTER_API_KEY) {
      console.warn('OPENROUTER_API_KEY not found. Tests involving real LLM calls might fail.');
    }
  });

  it('should schedule a one-time reminder', async () => {
    const { app, mockStorage, mockScheduler, mockBus } = setupTestApp();
    const flow = createTaskSchedulerFlow();
    const context: TaskSchedulerContext = {
      userId: 'user-123',
      message: 'Remind me to check the oven in 5 minutes',
    };
    const shared: SharedStore<TaskSchedulerContext> = { app, context };

    await flow.run(shared);

    // Verify tool call
    expect(mockStorage.saveReminder).toHaveBeenCalled();
    const savedReminder = mockStorage.saveReminder.mock.calls[0][0];
    expect(savedReminder.text).toContain('check the oven');
    expect(savedReminder.scheduleType).toBe('once');

    // Verify scheduler
    expect(mockScheduler.scheduleReminder).toHaveBeenCalled();

    // Verify final response
    expect(mockBus.emit).toHaveBeenCalledWith(
      'telegram.sendMessage',
      expect.objectContaining({
        chatId: 'chat-123',
        message: expect.stringContaining('check the oven'), // LLM usually repeats the text
      }),
    );
  }, 90000); // Increase timeout for LLM

  it('should schedule a recurring reminder', async () => {
    const { app, mockStorage, mockScheduler } = setupTestApp();
    const flow = createTaskSchedulerFlow();
    const context: TaskSchedulerContext = {
      userId: 'user-123',
      message: 'Remind me to drink water every hour',
    };
    const shared: SharedStore<TaskSchedulerContext> = { app, context };

    await flow.run(shared);

    // Verify tool call
    expect(mockStorage.saveReminder).toHaveBeenCalled();
    const savedReminder = mockStorage.saveReminder.mock.calls[0][0];
    expect(savedReminder.text).toContain('drink water');
    expect(savedReminder.scheduleType).toBe('cron');
    // "every hour" is usually "0 * * * *" or similar
    expect(savedReminder.scheduleValue).toMatch(/(\*|\d+)\s+(\*|\d+)\s+(\*|\d+)\s+(\*|\d+)\s+(\*|\d+)/);

    expect(mockScheduler.scheduleReminder).toHaveBeenCalled();
  }, 90000);

  it('should list reminders', async () => {
    const { app, mockStorage, mockBus } = setupTestApp();
    // Setup existing reminders
    const existingReminders: Task[] = [
      {
        id: 'r1',
        userId: 'user-123',
        taskName: 'reminder',
        parameters: {
          userId: 'user-123',
          message: 'Buy groceries',
        },
        scheduleType: 'once',
        scheduleValue: new Date(Date.now() + 3600000).toISOString(),
        createdAt: new Date(),
        timezone: 'UTC',
        active: true,
      },
    ];
    mockStorage.getReminders.mockResolvedValue(existingReminders);

    const flow = createTaskSchedulerFlow();
    const context: TaskSchedulerContext = {
      userId: 'user-123',
      message: 'What are my reminders?',
    };
    const shared: SharedStore<TaskSchedulerContext> = { app, context };

    await flow.run(shared);

    // Verify reminderRepository was queried
    expect(mockStorage.getReminders).toHaveBeenCalledWith('user-123');

    // Verify response mentions the reminder
    expect(mockBus.emit).toHaveBeenCalledWith(
      'telegram.sendMessage',
      expect.objectContaining({
        chatId: 'chat-123',
        message: expect.stringMatching(/Buy groceries/i),
      }),
    );
  }, 90000);

  it('should cancel a reminder', async () => {
    const { app, mockStorage, mockScheduler, mockBus } = setupTestApp();
    // Setup existing reminders so LLM can see ID
    const existingReminders: Task[] = [
      {
        id: 'rem-to-cancel',
        userId: 'user-123',
        taskName: 'reminder',
        parameters: {
          userId: 'user-123',
          message: 'Remind me to cancel this reminder',
        },
        scheduleType: 'once',
        scheduleValue: new Date().toISOString(),
        createdAt: new Date(),
        timezone: 'UTC',
        active: true,
      },
    ];
    mockStorage.getReminders.mockResolvedValue(existingReminders);

    const flow = createTaskSchedulerFlow();
    const context: TaskSchedulerContext = {
      userId: 'user-123',
      message: 'Cancel the reminder with ID rem-to-cancel',
    };
    const shared: SharedStore<TaskSchedulerContext> = { app, context };

    await flow.run(shared);

    // Verify cancellation
    expect(mockStorage.deleteReminder).toHaveBeenCalledWith('rem-to-cancel');
    expect(mockScheduler.removeJob).toHaveBeenCalledWith('rem-to-cancel');

    // Verify confirmation
    expect(mockBus.emit).toHaveBeenCalledWith(
      'telegram.sendMessage',
      expect.objectContaining({
        chatId: 'chat-123',
        message: expect.stringMatching(/cancel/i),
      }),
    );
  }, 90000);
});
