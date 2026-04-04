import { on } from 'node:events';
import { z } from 'zod';
import { router, publicProcedure } from './trpc.js';
import type { Bus } from '../../infra/bus.js';

export type BusEvent =
  | { type: 'session:statusChange'; sessionId: string; flowName: string; userId: string; from: string; to: string }
  | { type: 'session:message:update'; sessionId: string; flowName: string; userId: string }
  | { type: 'session:message'; sessionId: string; message: string }
  | { type: 'flow:pause'; runId: string; sessionId: string; flowName: string }
  | { type: 'flow:resume'; runId: string; sessionId: string; flowName: string }
  | { type: 'flow:exit'; runId: string; sessionId: string; flowName: string }
  | { type: 'flow:error'; runId: string; sessionId: string; flowName: string };

type BusEventName =
  | 'session:statusChange'
  | 'session:message:update'
  | 'session:message'
  | 'flow:pause'
  | 'flow:resume'
  | 'flow:exit'
  | 'flow:error';

const BUS_EVENT_NAMES: BusEventName[] = [
  'session:statusChange',
  'session:message:update',
  'session:message',
  'flow:pause',
  'flow:resume',
  'flow:exit',
  'flow:error',
];

/**
 * Merge multiple named EventEmitter events into a single async iterable.
 * Each yielded item is [eventName, eventData].
 */
async function* mergeEvents(
  bus: Bus,
  names: BusEventName[],
  signal: AbortSignal,
): AsyncGenerator<[BusEventName, Record<string, unknown>]> {
  type QueueItem = [BusEventName, Record<string, unknown>];

  const queue: QueueItem[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  const push = (name: BusEventName) => (data: Record<string, unknown>) => {
    queue.push([name, data]);
    resolve?.();
    resolve = null;
  };

  const handlers: [BusEventName, (data: Record<string, unknown>) => void][] = names.map((name) => {
    const handler = push(name);
    bus.on(name, handler);
    return [name, handler];
  });

  signal.addEventListener('abort', () => {
    done = true;
    resolve?.();
    resolve = null;
  });

  try {
    while (!done) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (done) break;
      await new Promise<void>((r) => {
        resolve = r;
      });
    }
  } finally {
    for (const [name, handler] of handlers) {
      bus.off(name, handler);
    }
  }
}

export const appRouter = router({
  // ─── Queries ──────────────────────────────────────────────────────────────

  listBuiltinAgents: publicProcedure.query(({ ctx }) => {
    return ctx.app.agents.getAgents().map((f) => ({ name: f.name, description: f.description }));
  }),

  listSchemaAgents: publicProcedure.query(({ ctx }) => {
    return ctx.app.agents.getAgenticLoopSchemas().map((s) => ({ name: s.name, description: s.description }));
  }),

  listActiveSessions: publicProcedure.query(({ ctx }) => {
    const results: { sessionId: string; flowName: string; status: string }[] = [];
    for (const agent of ctx.app.agents.getActiveAgents()) {
      for (const session of agent.allSessions) {
        if (session.userId === ctx.userId) {
          results.push({ sessionId: session.id, flowName: session.flowName, status: session.status });
        }
      }
    }
    return results;
  }),

  getSession: publicProcedure.input(z.object({ sessionId: z.string() })).query(async ({ ctx, input }) => {
    return ctx.app.data.flowSessionRepository.getSession(input.sessionId);
  }),

  getUserSessions: publicProcedure.query(async ({ ctx }) => {
    return ctx.app.services.sessionService.getRootSessions(ctx.userId);
  }),

  getAgentSessions: publicProcedure
    .input(z.object({ from: z.string().datetime(), to: z.string().datetime().optional() }))
    .query(async ({ ctx, input }) => {
      const toDate = input.to ? new Date(input.to) : new Date(Date.now() + 24 * 60 * 60 * 1000);
      const agentSessions = await ctx.app.data.agentSessionRepository.getByUserIdInWindow(
        ctx.userId,
        new Date(input.from),
        toDate,
      );
      const result = await Promise.all(
        agentSessions.map(async (as) => {
          const flowSessions = await ctx.app.data.flowSessionRepository.getByAgentSessionId(as.id);
          const inp = (as.currentStep?.items[0]?.input as any);
          const schemaFlowName = inp?.name ?? inp?.schema?.name ?? null;
          return { ...as, flowSessions, schemaFlowName };
        }),
      );
      return result;
    }),

  getSchema: publicProcedure
    .input(z.object({ flowName: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.app.data.agenticLoopSchemaRepository.getSchema(input.flowName);
    }),

  updateSchema: publicProcedure
    .input(
      z.object({
        flowName: z.string(),
        schema: z.object({
          description: z.string().optional(),
          userPromptTemplate: z.string().optional(),
          systemPrompt: z.string().optional(),
          toolNames: z.array(z.string()).optional(),
          skillNames: z.array(z.string()).optional(),
          contextPaths: z
            .object({
              files: z.array(z.string()),
              folders: z.array(z.string()),
            })
            .optional(),
          callLlmOptions: z.record(z.string(), z.unknown()).optional(),
          messageWindowConfig: z.record(z.string(), z.unknown()).optional(),
          agentLoopConfig: z
            .object({
              onError: z.enum(['askUser', 'retry']),
              maxLoopEntering: z.number(),
              loopExit: z.enum(['failure', 'bestAnswer']),
              useMemory: z.boolean(),
              useKnowledgeBase: z.boolean(),
            })
            .optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.app.data.agenticLoopSchemaRepository.updateSchema(input.flowName, input.schema as any);
    }),

  // ─── Mutations ────────────────────────────────────────────────────────────

  runAgent: publicProcedure
    .input(z.object({ agentName: z.string(), message: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.app.data.userRepository.getUser(ctx.userId);
      if (!user) throw new Error(`User '${ctx.userId}' not found`);
      ctx.webChannel.markUserActive(ctx.userId);
      const agent = await ctx.app.agents.runAgent(input.agentName, { user }, { message: input.message });
      const firstSession = await agent.firstSession;
      return { sessionId: firstSession.id };
    }),

  continueAgent: publicProcedure
    .input(z.object({ agentName: z.string(), message: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.app.data.userRepository.getUser(ctx.userId);
      if (!user) throw new Error(`User '${ctx.userId}' not found`);
      ctx.webChannel.markUserActive(ctx.userId);
      const agent = await ctx.app.agents.continueAgent(input.agentName, { user }, { message: input.message });
      const firstSession = await agent.firstSession;
      return { sessionId: firstSession.id };
    }),

  continueSchemaAgent: publicProcedure
    .input(z.object({ flowName: z.string(), message: z.string() }))
    .mutation(async ({ ctx, input }) => {
      console.log(`[router.continueSchemaAgent] flowName='${input.flowName}' message='${input.message}'`);
      if (input.flowName === 'Agentic Loop') throw new Error(`[router.continueSchemaAgent] flowName is 'Agentic Loop' — UI failed to resolve schemaFlowName`);
      const user = await ctx.app.data.userRepository.getUser(ctx.userId);
      if (!user) throw new Error(`User '${ctx.userId}' not found`);
      ctx.webChannel.markUserActive(ctx.userId);
      const agent = await ctx.app.agents.continueAgent('Agentic Loop', { user }, { name: input.flowName, message: input.message });
      const firstSession = await agent.firstSession;
      console.log(`[router.continueSchemaAgent] agent session id='${firstSession.id}'`);
      return { sessionId: firstSession.id };
    }),

  deleteAgentSession: publicProcedure
    .input(z.object({ agentSessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.app.data.agentSessionRepository.deleteWithFlowSessions(input.agentSessionId);
      return { ok: true };
    }),

  sendMessage: publicProcedure
    .input(z.object({ sessionId: z.string(), message: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.app.data.userRepository.getUser(ctx.userId);
      if (!user) throw new Error(`User '${ctx.userId}' not found`);
      const session = await ctx.app.data.flowSessionRepository.getSession(input.sessionId);
      if (!session) throw new Error(`Session '${input.sessionId}' not found`);
      ctx.webChannel.markUserActive(ctx.userId);
      ctx.app.infra.bus.emit(`user:message:${ctx.userId}:${input.sessionId}`, {
        session,
        message: input.message,
        user,
      });
      return { ok: true };
    }),

  // ─── Subscriptions ────────────────────────────────────────────────────────

  streamEvents: publicProcedure.input(z.object({ sessionId: z.string().optional() })).subscription(async function* ({
    ctx,
    input,
    signal,
  }) {
    const { bus } = ctx.app.infra;
    const { userId } = ctx;
    const { sessionId } = input;
    const abortSignal = signal ?? new AbortController().signal;

    console.log(`[streamEvents] subscription started userId=${userId} sessionId=${sessionId ?? 'any'}`);

    for await (const [eventName, data] of mergeEvents(bus, BUS_EVENT_NAMES, abortSignal)) {
      console.log(`[streamEvents] raw event name=${eventName} data=${JSON.stringify(data).slice(0, 200)}`);
      if (eventName === 'session:statusChange' || eventName === 'session:message:update') {
        if (data['userId'] !== userId) {
          console.log(`[streamEvents] skip ${eventName}: userId mismatch (event=${data['userId']} ctx=${userId})`);
          continue;
        }
        // session:statusChange is not filtered by sessionId — child sessions complete
        // under a different id than the root session the client subscribed to.
        // session:message:update is filtered so the client only refetches relevant sessions.
        if (eventName === 'session:message:update' && sessionId && data['sessionId'] !== sessionId) {
          console.log(`[streamEvents] skip ${eventName}: sessionId mismatch (event=${data['sessionId']} filter=${sessionId})`);
          continue;
        }
        console.log(`[streamEvents] yield ${eventName} sessionId=${data['sessionId']}`);
        yield { type: eventName, ...data } as BusEvent;
      } else if (eventName === 'session:message') {
        const sess = data['session'] as Record<string, unknown> | undefined;
        if (sess?.['userId'] !== userId) {
          console.log(`[streamEvents] skip session:message: userId mismatch (event=${sess?.['userId']} ctx=${userId})`);
          continue;
        }
        if (sessionId && sess?.['id'] !== sessionId) {
          console.log(`[streamEvents] skip session:message: sessionId mismatch (event=${sess?.['id']} filter=${sessionId})`);
          continue;
        }
        console.log(`[streamEvents] yield session:message sessionId=${sess?.['id']} message=${String(data['message']).slice(0, 80)}`);
        yield {
          type: 'session:message',
          sessionId: sess?.['id'] as string,
          message: data['message'] as string,
        } satisfies BusEvent;
      } else if (
        eventName === 'flow:pause' ||
        eventName === 'flow:resume' ||
        eventName === 'flow:exit' ||
        eventName === 'flow:error'
      ) {
        yield { type: eventName, ...data } as BusEvent;
      }
    }
  }),
});

export type AppRouter = typeof appRouter;
