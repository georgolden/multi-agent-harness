import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, trpcClientConfig } from './trpcClient.js';
import { Sidebar } from './components/sidebar/Sidebar.js';
import { ChatPanel } from './components/chat/ChatPanel.js';
import { SessionsPanel } from './components/sessions/SessionsPanel.js';
import type { AgentSession, AgentFlowSession } from './types.js';

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
  const [activeAgentSession, setActiveAgentSession] = useState<AgentSession | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newSession, setNewSession] = useState<{ sessionId: string; flowName: string } | null>(null);

  const { data: flows, isLoading: loadingFlows } = trpc.listFlows.useQuery();

  const flowSessions: AgentFlowSession[] = activeAgentSession?.flowSessions ?? [];
  const agentName: string | null = activeAgentSession?.agentName ?? selectedFlow;

  const handleSessionCreated = (sessionId: string, flowName: string) => {
    setNewSession({ sessionId, flowName });
  };

  // Called from SessionsPanel — carries the full AgentSession so header always has context.
  const handleSelectSession = (agentSession: AgentSession, flowSessionId: string) => {
    const fs = agentSession.flowSessions.find((f) => f.id === flowSessionId);
    if (!fs) return;
    setActiveAgentSession(agentSession);
    setSelectedSession({ id: flowSessionId, flowName: fs.flowName });
    setSelectedFlow(null); // clear sidebar selection — session panel and sidebar are mutually exclusive
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
          setActiveAgentSession(null);
        }}
      />

      <ChatPanel
        selectedFlow={selectedFlow}
        selectedSession={selectedSession}
        onSessionCreated={handleSessionCreated}
        onSelectFlowSession={(flowSessionId) => {
          if (!activeAgentSession) return;
          handleSelectSession(activeAgentSession, flowSessionId);
        }}
        flowDescription={flows?.find((f) => f.name === selectedFlow)?.description ?? null}
        agentName={agentName}
        flowSessions={flowSessions}
      />

      <SessionsPanel
        newSession={newSession}
        activeSessionId={selectedSession?.id ?? null}
        onSelectSession={handleSelectSession}
      />
    </div>
  );
}
