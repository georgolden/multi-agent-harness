import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, trpcClientConfig } from './trpcClient.js';
import { Sidebar } from './components/sidebar/Sidebar.js';
import { ChatPanel } from './components/chat/ChatPanel.js';
import { SessionsPanel } from './components/sessions/SessionsPanel.js';

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
  const [selectedFlow, setSelectedFlow] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<{ id: string; flowName: string } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newSession, setNewSession] = useState<{ sessionId: string; flowName: string } | null>(null);

  const { data: flows, isLoading: loadingFlows } = trpc.listFlows.useQuery();

  const handleSessionCreated = (sessionId: string, flowName: string) => {
    setNewSession({ sessionId, flowName });
  };

  const handleSelectSession = (id: string, flowName: string) => {
    setSelectedSession({ id, flowName });
    setSelectedFlow(flowName);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-100">
      <Sidebar
        flows={flows}
        loadingFlows={loadingFlows}
        selectedFlow={selectedFlow}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        onSelectFlow={(name) => {
          setSelectedFlow(name);
          setSelectedSession(null);
        }}
      />

      <ChatPanel
        selectedFlow={selectedFlow}
        selectedSession={selectedSession}
        onSessionCreated={handleSessionCreated}
      />

      <SessionsPanel
        newSession={newSession}
        activeSessionId={selectedSession?.id ?? null}
        onSelectSession={handleSelectSession}
      />
    </div>
  );
}
