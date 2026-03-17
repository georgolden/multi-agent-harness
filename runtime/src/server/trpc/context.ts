import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import type { App } from '../../app.js';
import type { WebChannel } from '../channel/webChannel.js';

export type TrpcContext = {
  app: App;
  userId: string;
  webChannel: WebChannel;
};

export function createContext(app: App, webChannel: WebChannel) {
  return async function ({ req }: CreateFastifyContextOptions): Promise<TrpcContext> {
    const userId = (req.headers['x-user-id'] as string) ?? 'local';
    return { app, userId, webChannel };
  };
}
