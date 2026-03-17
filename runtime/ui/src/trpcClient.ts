import { createTRPCReact } from '@trpc/react-query';
import { createWSClient, wsLink, httpBatchLink, splitLink } from '@trpc/client';
import type { AppRouter } from '../../src/server/trpc/router.js';

export const trpc = createTRPCReact<AppRouter>();

const isDev = import.meta.env.DEV;

const wsUrl = isDev ? 'ws://localhost:3000/trpc' : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/trpc`;
const httpUrl = isDev ? 'http://localhost:3000/trpc' : '/trpc';

const wsClient = createWSClient({ url: wsUrl });

export const trpcClientConfig = {
  links: [
    splitLink({
      condition: (op) => op.type === 'subscription',
      true: wsLink({ client: wsClient }),
      false: httpBatchLink({ url: httpUrl }),
    }),
  ],
};
