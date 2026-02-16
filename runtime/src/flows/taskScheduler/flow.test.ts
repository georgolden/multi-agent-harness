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
    getTasks: vi.fn(),
    getUserTimezone: vi.fn(),
    saveTask: vi.fn(),
    deleteTask: vi.fn(),
    getTaskForUser: vi.fn(),
    setUserTimezone: vi.fn(),
    getAllTasks: vi.fn(),
    getTask: vi.fn(),
  };

  const mockScheduler = {
    scheduleTask: vi.fn(),
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
      taskRepository: mockStorage,
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
  mockStorage.getTasks.mockResolvedValue([]);

  // Mock saveTask to return what was passed with an ID
  mockStorage.saveTask.mockImplementation(async (r: any) => ({
    ...r,
    id: 'test-task-id',
    createdAt: new Date(),
    active: true,
  }));

  // Mock getTaskForUser for cancellation
  mockStorage.getTaskForUser.mockImplementation(async (id: string, userId: string) => ({
    id,
    userId,
    taskName: 'reminder',
    parameters: { message: 'Test Task Schedule' },
    scheduleType: 'once',
    scheduleValue: new Date().toISOString(),
    timezone: 'UTC',
    createdAt: new Date(),
    active: true,
  }));

  return { app, mockStorage, mockScheduler, mockBus, messageHistory };
}

describe('Task Schedule Flow Integration', () => {
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
    expect(mockStorage.saveTask).toHaveBeenCalled();
    const savedTask = mockStorage.saveTask.mock.calls[0][0];
    expect(savedTask.taskName).toBe('reminder');
    expect(savedTask.parameters.message).toContain('check the oven');
    expect(savedTask.scheduleType).toBe('once');

    // Verify scheduler
    expect(mockScheduler.scheduleTask).toHaveBeenCalled();

    // Verify final response
    expect(mockBus.emit).toHaveBeenCalledWith(
      'askUser',
      expect.objectContaining({
        userId: 'user-123',
        message: expect.stringMatching(/check the oven/i), // LLM usually repeats the text
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
    expect(mockStorage.saveTask).toHaveBeenCalled();
    const savedTask = mockStorage.saveTask.mock.calls[0][0];
    expect(savedTask.taskName).toBe('reminder');
    expect(savedTask.parameters.message).toMatch(/drink water/i);
    expect(savedTask.scheduleType).toBe('cron');
    // "every hour" is usually "0 * * * *" or similar
    expect(savedTask.scheduleValue).toMatch(/(\*|\d+)\s+(\*|\d+)\s+(\*|\d+)\s+(\*|\d+)\s+(\*|\d+)/);

    expect(mockScheduler.scheduleTask).toHaveBeenCalled();
  }, 90000);

  it('should list reminders', async () => {
    const { app, mockStorage, mockBus } = setupTestApp();
    // Setup existing tasks
    const existingTasks: Task[] = [
      {
        id: 'r1',
        userId: 'user-123',
        taskName: 'reminder',
        parameters: {
          message: 'Buy groceries',
        },
        scheduleType: 'once',
        scheduleValue: new Date(Date.now() + 3600000).toISOString(),
        createdAt: new Date(),
        timezone: 'UTC',
        active: true,
      },
    ];
    mockStorage.getTasks.mockResolvedValue(existingTasks);

    const flow = createTaskSchedulerFlow();
    const context: TaskSchedulerContext = {
      userId: 'user-123',
      message: 'What are my reminders?',
    };
    const shared: SharedStore<TaskSchedulerContext> = { app, context };

    await flow.run(shared);

    // Verify taskRepository was queried
    expect(mockStorage.getTasks).toHaveBeenCalledWith('user-123');

    // Verify response mentions the reminder
    expect(mockBus.emit).toHaveBeenCalledWith(
      'askUser',
      expect.objectContaining({
        userId: 'user-123',
        message: expect.stringMatching(/Buy groceries/i),
      }),
    );
  }, 90000);

  it('should cancel a reminder', async () => {
    const { app, mockStorage, mockScheduler, mockBus } = setupTestApp();
    // Setup existing tasks so LLM can see ID
    const existingTasks: Task[] = [
      {
        id: 'rem-to-cancel',
        userId: 'user-123',
        taskName: 'reminder',
        parameters: {
          message: 'Remind me to cancel this reminder',
        },
        scheduleType: 'once',
        scheduleValue: new Date().toISOString(),
        createdAt: new Date(),
        timezone: 'UTC',
        active: true,
      },
    ];
    mockStorage.getTasks.mockResolvedValue(existingTasks);

    const flow = createTaskSchedulerFlow();
    const context: TaskSchedulerContext = {
      userId: 'user-123',
      message: 'Cancel the reminder with ID rem-to-cancel',
    };
    const shared: SharedStore<TaskSchedulerContext> = { app, context };

    await flow.run(shared);

    // Verify cancellation
    expect(mockStorage.deleteTask).toHaveBeenCalledWith('rem-to-cancel');
    expect(mockScheduler.removeJob).toHaveBeenCalledWith('rem-to-cancel');

    // Verify confirmation
    expect(mockBus.emit).toHaveBeenCalledWith(
      'askUser',
      expect.objectContaining({
        userId: 'user-123',
        message: expect.stringMatching(/cancel/i),
      }),
    );
  }, 90000);
});
