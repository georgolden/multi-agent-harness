import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, trpcClientConfig } from './trpcClient.js';
import { Sidebar } from './components/sidebar/Sidebar.js';
import { ChatPanel } from './components/chat/ChatPanel.js';
import { SessionsPanel } from './components/sessions/SessionsPanel.js';
import { SchemaEditor } from './components/editor/SchemaEditor.js';
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
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<{ id: string; flowName: string } | null>(null);
  const [activeAgentSession, setActiveAgentSession] = useState<AgentSession | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newSession, setNewSession] = useState<{ sessionId: string; flowName: string } | null>(null);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);

  const { data: builtinAgents, isLoading: loadingBuiltin } = trpc.listBuiltinAgents.useQuery();
  const { data: schemaAgents, isLoading: loadingSchema } = trpc.listSchemaAgents.useQuery();

  const allAgents = [...(builtinAgents ?? []), ...(schemaAgents ?? [])];
  const flowSessions: AgentFlowSession[] = activeAgentSession?.flowSessions ?? [];
  const agentName: string | null = activeAgentSession?.agentName ?? selectedAgent;
  const selectedAgentDescription = allAgents.find((a) => a.name === selectedAgent)?.description ?? null;

  const handleSessionCreated = (sessionId: string, flowName: string) => {
    setNewSession({ sessionId, flowName });
  };

  const handleSelectSession = (agentSession: AgentSession, flowSessionId: string) => {
    const fs = agentSession.flowSessions.find((f) => f.id === flowSessionId);
    if (!fs) return;
    setActiveAgentSession(agentSession);
    setSelectedSession({ id: flowSessionId, flowName: fs.flowName });
    setSelectedAgent(null);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-100">
      <Sidebar
        builtinAgents={builtinAgents}
        schemaAgents={schemaAgents}
        loadingAgents={loadingBuiltin || loadingSchema}
        selectedAgent={selectedAgent}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        onSelectAgent={(name) => {
          setSelectedAgent(name);
          setSelectedSession(null);
          setActiveAgentSession(null);
          setEditingAgent(null);
        }}
        onEditAgent={(name) => {
          setEditingAgent(name);
          setSelectedAgent(null);
          setSelectedSession(null);
          setActiveAgentSession(null);
        }}
      />

      {editingAgent ? (
        <SchemaEditor flowName={editingAgent} onClose={() => setEditingAgent(null)} />
      ) : (
        <ChatPanel
          selectedFlow={selectedAgent}
          selectedSession={selectedSession}
          onSessionCreated={handleSessionCreated}
          onSelectFlowSession={(flowSessionId) => {
            if (!activeAgentSession) return;
            handleSelectSession(activeAgentSession, flowSessionId);
          }}
          flowDescription={selectedAgentDescription}
          agentName={agentName}
          flowSessions={flowSessions}
        />
      )}

      <SessionsPanel
        newSession={newSession}
        activeSessionId={selectedSession?.id ?? null}
        onSelectSession={handleSelectSession}
      />
    </div>
  );
}
