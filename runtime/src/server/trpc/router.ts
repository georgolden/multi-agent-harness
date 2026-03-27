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

  listFlows: publicProcedure.query(({ ctx }) => {
    const builtin = ctx.app.agents.getAgents().map((f) => ({ name: f.name, description: f.description }));
    const schemas = ctx.app.agents
      .getAgenticLoopSchemas()
      .map((s) => ({ name: s.flowName, description: s.description }));
    return [...builtin, ...schemas];
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

  // ─── Mutations ────────────────────────────────────────────────────────────

  runFlow: publicProcedure
    .input(z.object({ flowName: z.string(), message: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.app.data.userRepository.getUser(ctx.userId);
      if (!user) throw new Error(`User '${ctx.userId}' not found`);
      ctx.webChannel.markUserActive(ctx.userId);
      const agent = await ctx.app.agents.runAgent(input.flowName, { user }, { message: input.message });
      return { sessionId: agent.allSessions[0].id };
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

    for await (const [eventName, data] of mergeEvents(bus, BUS_EVENT_NAMES, abortSignal)) {
      if (eventName === 'session:statusChange' || eventName === 'session:message:update') {
        if (data['userId'] !== userId) continue;
        if (sessionId && data['sessionId'] !== sessionId) continue;
        yield { type: eventName, ...data } as BusEvent;
      } else if (eventName === 'session:message') {
        const sess = data['session'] as Record<string, unknown> | undefined;
        if (sess?.['userId'] !== userId) continue;
        if (sessionId && sess?.['id'] !== sessionId) continue;
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
