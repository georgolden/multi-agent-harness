import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, trpcClientConfig } from './trpcClient.js';

const queryClient = new QueryClient();
const trpcClient = trpc.createClient(trpcClientConfig);

export function App() {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <Main />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

function Main() {
  const { data: flows } = trpc.listFlows.useQuery();
  const { data: sessions } = trpc.getUserSessions.useQuery();

  return (
    <div style={{ fontFamily: 'monospace', padding: '1rem' }}>
      <h2>AGI Runtime</h2>
      <section>
        <h3>Flows</h3>
        <pre>{JSON.stringify(flows, null, 2)}</pre>
      </section>
      <section>
        <h3>Sessions</h3>
        <pre>{JSON.stringify(sessions, null, 2)}</pre>
      </section>
    </div>
  );
}
