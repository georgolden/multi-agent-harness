import { describe, it, expect, vi, beforeAll } from 'vitest';
import 'dotenv/config';
import { createTaskSchedulerFlow } from './flow.js';
import { packet } from '../../utils/agent/flow.js';
import { App } from '../../app.js';
import { TaskSchedulerContext } from './types.js';
import { Task } from '../../data/taskRepository/types.js';
import { Tasks } from '../../tasks/index.js';

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

  // Mock session factory — returns a plain object that mimics Session methods
  let sessionCounter = 0;

  function createMockSession(params: any) {
    const sessionId = `test-session-${sessionCounter++}`;
    const session: any = {
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
      toolSchemas: [],
      skillSchemas: [],
      toolLogs: [],
      skillLogs: [],
      contextFoldersInfos: [],
      callLlmOptions: {},
      startedAt: new Date(),

      async addMessages(messages: any[]) {
        const fullMessages = messages.map((msg: any) => ({
          timestamp: new Date(),
          message: msg.message,
        }));
        session.messages.push(...fullMessages);
        session.activeMessages = [...session.messages];
        return session;
      },
      async respond(_user: any, message: string) {
        mockBus.emit('session:message', { session, message });
        return session;
      },
      async running() {
        session.status = 'running';
        return session;
      },
      async complete() {
        session.status = 'completed';
        session.endedAt = new Date();
        return session;
      },
      async fail() {
        session.status = 'failed';
        session.endedAt = new Date();
        return session;
      },
      async pause() {
        session.status = 'paused';
        return session;
      },
      async resume() {
        session.status = 'running';
        return session;
      },
      addAgentTools(tools: any[]) {
        // No-op for tests
      },
      onUserMessage(cb: any) {
        mockBus.on(`user:message:${session.userId}:${session.id}`, ({ message }: any) => {
          return cb({ session, message, user: { id: session.userId } });
        });
        return session;
      },
    };
    return session;
  }

  const mockSessionService = {
    create: vi.fn().mockImplementation(async (params: any) => createMockSession(params)),
    get: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };

  const app = {
    data: {
      taskRepository: mockStorage,
    },
    services: {
      scheduler: mockScheduler,
      sessionService: mockSessionService,
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

  return { app, mockStorage, mockScheduler, mockBus, mockSessionService };
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
      user: { id: 'user-123' } as any,
    };
    const data = 'Remind me to check the oven in 5 minutes';
    await flow.run(packet({ data, context, deps: app }));

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
      expect.stringMatching(/session:message:/),
      expect.objectContaining({
        message: expect.stringMatching(/check the oven/i),
      }),
    );
  }, 90000); // Increase timeout for LLM

  it('should schedule a recurring reminder', async () => {
    const { app, mockStorage, mockScheduler } = setupTestApp();
    const flow = createTaskSchedulerFlow();
    const context: TaskSchedulerContext = {
      user: { id: 'user-123' } as any,
    };
    const data = 'Remind me to drink water every hour';
    await flow.run(packet({ data, context, deps: app }));

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
      user: { id: 'user-123' } as any,
    };
    const data = 'What are my reminders?';
    await flow.run(packet({ data, context, deps: app }));

    // Verify taskRepository was queried
    expect(mockStorage.getTasks).toHaveBeenCalledWith('user-123');

    // Verify response mentions the reminder
    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.stringMatching(/session:message:/),
      expect.objectContaining({
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
      user: { id: 'user-123' } as any,
    };
    const data = 'Cancel the reminder with ID rem-to-cancel';
    await flow.run(packet({ data, context, deps: app }));

    // Verify cancellation
    expect(mockStorage.deleteTask).toHaveBeenCalledWith('rem-to-cancel');
    expect(mockScheduler.removeJob).toHaveBeenCalledWith('rem-to-cancel');

    // Verify confirmation
    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.stringMatching(/session:message:/),
      expect.objectContaining({
        message: expect.stringMatching(/cancel/i),
      }),
    );
  }, 90000);

  it('should schedule a one-time agent flow task', async () => {
    const { app, mockStorage, mockScheduler, mockBus } = setupTestApp();
    const flow = createTaskSchedulerFlow();
    const context: TaskSchedulerContext = {
      user: { id: 'user-123' } as any,
    };
    const data =
      'Schedule personalAssistantLookup builtin flow in 10 minutes with message: what are my time spending for today';
    await flow.run(packet({ data, context, deps: app }));

    // Verify tool call
    expect(mockStorage.saveTask).toHaveBeenCalled();
    const savedTask = mockStorage.saveTask.mock.calls[0][0];
    expect(savedTask.taskName).toBe('runAgentFlow');
    expect(savedTask.parameters.flowName).toBe('personalAssistantLookup');
    expect(savedTask.parameters.agentType).toBe('builtin');
    expect(savedTask.parameters.message).toMatch(/time spending/i);
    expect(savedTask.scheduleType).toBe('once');

    // Verify scheduler
    expect(mockScheduler.scheduleTask).toHaveBeenCalled();

    // Verify final response mentions the task details
    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.stringMatching(/session:message:/),
      expect.objectContaining({
        message: expect.stringMatching(/time spending|Set Task/i),
      }),
    );
  }, 90000);

  it('should schedule a recurring agent flow task', async () => {
    const { app, mockStorage, mockScheduler, mockBus } = setupTestApp();
    const flow = createTaskSchedulerFlow();
    const context: TaskSchedulerContext = {
      user: { id: 'user-123' } as any,
    };
    const data =
      'Run personalAssistantLookup builtin flow every day at 9am with the message: what are my time spending for today';
    await flow.run(packet({ data, context, deps: app }));

    // Verify tool call
    expect(mockStorage.saveTask).toHaveBeenCalled();
    const savedTask = mockStorage.saveTask.mock.calls[0][0];
    expect(savedTask.taskName).toBe('runAgentFlow');
    expect(savedTask.parameters.flowName).toBe('personalAssistantLookup');
    expect(savedTask.parameters.agentType).toBe('builtin');
    expect(savedTask.parameters.message).toMatch(/time spending/i);
    expect(savedTask.scheduleType).toBe('cron');
    // "every day at 9am" is usually "0 9 * * *"
    expect(savedTask.scheduleValue).toMatch(/(\*|\d+)\s+(\*|\d+)\s+(\*|\d+)\s+(\*|\d+)\s+(\*|\d+)/);

    expect(mockScheduler.scheduleTask).toHaveBeenCalled();

    // Verify final response mentions the task details
    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.stringMatching(/session:message:/),
      expect.objectContaining({
        message: expect.stringMatching(/time spending|Set Task/i),
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
      user: { id: 'user-123' } as any,
    };
    const data = 'What are my scheduled tasks?';
    await flow.run(packet({ data, context, deps: app }));

    // Verify taskRepository was queried
    expect(mockStorage.getTasks).toHaveBeenCalledWith('user-123');

    // Verify response mentions both tasks (single respond call containing both)
    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.stringMatching(/session:message:/),
      expect.objectContaining({
        message: expect.stringMatching(/Buy groceries/i),
      }),
    );
    expect(mockBus.emit).toHaveBeenCalledWith(
      expect.stringMatching(/session:message:/),
      expect.objectContaining({
        message: expect.stringMatching(/personalAssistantLookup|time spending/i),
      }),
    );
  }, 90000);
});
