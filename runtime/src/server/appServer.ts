import Fastify from 'fastify';
import ws from '@fastify/websocket';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { createContext } from './trpc/context.js';
import { appRouter } from './trpc/router.js';
import { WebChannel } from './channel/webChannel.js';
import type { App } from '../app.js';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class AppServer {
  private fastify: ReturnType<typeof Fastify>;
  private app: App;
  webChannel: WebChannel;

  constructor(app: App) {
    this.app = app;
    this.fastify = Fastify({ logger: false });
    this.webChannel = new WebChannel(app);
  }

  async start(): Promise<void> {
    // Ensure default local user exists
    await this.app.data.userRepository.saveUser({
      userId: 'local',
      name: 'Local User',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    // Register WebChannel with ChannelService
    this.app.services.channel.registerChannel(this.webChannel);

    await this.fastify.register(cors, {
      origin: process.env.NODE_ENV !== 'production' ? 'http://localhost:5173' : false,
    });

    await this.fastify.register(ws);

    if (process.env.NODE_ENV === 'production') {
      await this.fastify.register(staticPlugin, {
        root: join(__dirname, '../../ui/dist'),
        prefix: '/',
      });
    }

    await this.fastify.register(fastifyTRPCPlugin, {
      prefix: '/trpc',
      useWSS: true,
      trpcOptions: {
        router: appRouter,
        createContext: createContext(this.app, this.webChannel),
      },
    });

    const port = Number(process.env.PORT ?? 3000);
    await this.fastify.listen({ port, host: '0.0.0.0' });
    console.log(`[AppServer] Listening on http://localhost:${port}`);
  }

  async stop(): Promise<void> {
    await this.fastify.close();
  }
}
