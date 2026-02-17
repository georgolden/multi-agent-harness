import { describe, it, expect, vi, beforeAll } from 'vitest';
import 'dotenv/config';
import { createTaskSchedulerFlow } from './flow.js';
import { App } from '../../app.js';
import { SharedStore } from '../../types.js';
import { TaskSchedulerContext } from './types.js';
import { Task } from '../../data/taskRepository/types.js';
import { Tasks } from '../../tasks/index.js';
import type { FlowSession } from '../../data/flowSessionRepository/types.js';

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

  const mockFlowSessionRepository = {
    createSession: vi.fn(),
    getSession: vi.fn(),
    addMessages: vi.fn(),
    updateStatus: vi.fn(),
  };

  const app = {
    data: {
      taskRepository: mockStorage,
      flowSessionRepository: mockFlowSessionRepository,
    },
    services: {
      scheduler: mockScheduler,
    },
    infra: {
      bus: mockBus,
    },
  } as unknown as App;

  // Add real Tasks instance (read-only, no side effects)
  const tasks = new Tasks(app);
  (app as any).tasks = tasks;

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

  // Mock flow session repository with stateful session tracking
  let sessionCounter = 0;
  const sessions = new Map<string, any>();

  mockFlowSessionRepository.createSession.mockImplementation(async (params: any) => {
    const sessionId = `test-session-${sessionCounter++}`;
    const session: FlowSession = {
      id: sessionId,
      userId: params.userId,
      flowName: params.flowName,
      systemPrompt: params.systemPrompt,
      userPromptTemplate: params.userPromptTemplate,
      status: 'running',
      parentSessionId: params.parentSessionId,
      messages: [],
      activeMessages: [],
      messageWindowConfig: params.messageWindowConfig || { keepFirstMessages: 2, slidingWindowSize: 20 },
      contextFiles: params.contextFiles || [],
      tools: params.tools || [],
      skills: params.skills || [],
      toolLogs: [],
      skillLogs: [],
      startedAt: new Date(),
    };
    sessions.set(sessionId, session);
    return session;
  });

  mockFlowSessionRepository.getSession.mockImplementation(async (sessionId: string) => {
    return sessions.get(sessionId) || null;
  });

  mockFlowSessionRepository.addMessages.mockImplementation(async (sessionId: string, messages: Omit<any, 'timestamp'>[]) => {
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    // Create full messages with timestamps (matching real implementation)
    const fullMessages = messages.map((msg) => ({
      timestamp: new Date(),
      message: msg.message,
    }));

    // Add to messages array
    session.messages.push(...fullMessages);

    // Simplified: all messages are active (no windowing in tests)
    session.activeMessages = session.messages;

    return session.activeMessages;
  });

  mockFlowSessionRepository.updateStatus.mockImplementation(async (sessionId: string, status: string) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.status = status;
      if (status === 'completed' || status === 'failed') {
        session.endedAt = new Date();
      }
    }
  });

  return { app, mockStorage, mockScheduler, mockBus, mockFlowSessionRepository };
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

  it('should schedule a one-time agent flow task', async () => {
    const { app, mockStorage, mockScheduler, mockBus } = setupTestApp();
    const flow = createTaskSchedulerFlow();
    const context: TaskSchedulerContext = {
      userId: 'user-123',
      message: 'Schedule personalAssistantLookup flow in 10 minutes with message: what are my time spending for today',
    };
    const shared: SharedStore<TaskSchedulerContext> = { app, context };

    await flow.run(shared);

    // Verify tool call
    expect(mockStorage.saveTask).toHaveBeenCalled();
    const savedTask = mockStorage.saveTask.mock.calls[0][0];
    expect(savedTask.taskName).toBe('runAgentFlow');
    expect(savedTask.parameters.flowName).toBe('personalAssistantLookup');
    expect(savedTask.parameters.message).toMatch(/time spending/i);
    expect(savedTask.scheduleType).toBe('once');

    // Verify scheduler
    expect(mockScheduler.scheduleTask).toHaveBeenCalled();

    // Verify final response
    expect(mockBus.emit).toHaveBeenCalledWith(
      'askUser',
      expect.objectContaining({
        userId: 'user-123',
        message: expect.stringMatching(/personalAssistantLookup|scheduled|agent/i),
      }),
    );
  }, 90000);

  it('should schedule a recurring agent flow task', async () => {
    const { app, mockStorage, mockScheduler, mockBus } = setupTestApp();
    const flow = createTaskSchedulerFlow();
    const context: TaskSchedulerContext = {
      userId: 'user-123',
      message:
        'Run personalAssistantLookup flow every day at 9am with the message: what are my time spending for today',
    };
    const shared: SharedStore<TaskSchedulerContext> = { app, context };

    await flow.run(shared);

    // Verify tool call
    expect(mockStorage.saveTask).toHaveBeenCalled();
    const savedTask = mockStorage.saveTask.mock.calls[0][0];
    expect(savedTask.taskName).toBe('runAgentFlow');
    expect(savedTask.parameters.flowName).toBe('personalAssistantLookup');
    expect(savedTask.parameters.message).toMatch(/time spending/i);
    expect(savedTask.scheduleType).toBe('cron');
    // "every day at 9am" is usually "0 9 * * *"
    expect(savedTask.scheduleValue).toMatch(/(\*|\d+)\s+(\*|\d+)\s+(\*|\d+)\s+(\*|\d+)\s+(\*|\d+)/);

    expect(mockScheduler.scheduleTask).toHaveBeenCalled();

    // Verify final response
    expect(mockBus.emit).toHaveBeenCalledWith(
      'askUser',
      expect.objectContaining({
        userId: 'user-123',
        message: expect.stringMatching(/personalAssistantLookup|scheduled|agent|daily/i),
      }),
    );
  }, 90000);

  it('should list both reminder and agent flow tasks', async () => {
    const { app, mockStorage, mockBus } = setupTestApp();
    // Setup existing tasks of both types
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
      {
        id: 'a1',
        userId: 'user-123',
        taskName: 'runAgentFlow',
        parameters: {
          flowName: 'personalAssistantLookup',
          message: 'what are my time spending for today',
        },
        scheduleType: 'cron',
        scheduleValue: '0 9 * * *',
        createdAt: new Date(),
        timezone: 'UTC',
        active: true,
      },
    ];
    mockStorage.getTasks.mockResolvedValue(existingTasks);

    const flow = createTaskSchedulerFlow();
    const context: TaskSchedulerContext = {
      userId: 'user-123',
      message: 'What are my scheduled tasks?',
    };
    const shared: SharedStore<TaskSchedulerContext> = { app, context };

    await flow.run(shared);

    // Verify taskRepository was queried
    expect(mockStorage.getTasks).toHaveBeenCalledWith('user-123');

    // Verify response mentions both tasks
    expect(mockBus.emit).toHaveBeenCalledWith(
      'askUser',
      expect.objectContaining({
        userId: 'user-123',
        message: expect.stringMatching(/Buy groceries/i),
      }),
    );
    expect(mockBus.emit).toHaveBeenCalledWith(
      'askUser',
      expect.objectContaining({
        userId: 'user-123',
        message: expect.stringMatching(/personalAssistantLookup|time spending/i),
      }),
    );
  }, 90000);
});
