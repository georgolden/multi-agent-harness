import { useEffect, useRef, useState } from 'react';
import { Layers, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { trpc } from '../../trpcClient.js';
import { SessionStatusBadge } from './SessionStatusBadge.js';
import type { AgentSession, AgentFlowSession, AgentStatus, SessionStatus } from '../../types.js';

interface NewSessionEntry {
  sessionId: string;
  flowName: string;
}

interface SessionsPanelProps {
  newSession: NewSessionEntry | null;
  activeSessionId: string | null;
  onSelectSession: (id: string, flowName: string) => void;
}

type FilterTab = 'all' | 'running' | 'completed' | 'paused' | 'failed';

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'paused', label: 'Paused' },
  { key: 'completed', label: 'Done' },
  { key: 'failed', label: 'Failed' },
];

function timeAgo(date: string | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = Math.max(0, now - then);
  const secs = Math.floor(diff / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  if (secs < 60) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function statusColor(status: AgentStatus | SessionStatus): string {
  if (status === 'running') return 'bg-gradient-to-br from-blue-500 to-violet-600';
  if (status === 'paused') return 'bg-gradient-to-br from-yellow-400 to-orange-500';
  if (status === 'failed') return 'bg-red-100';
  return 'bg-gray-100';
}

interface AgentSessionCardProps {
  agentSession: AgentSession;
  activeSessionId: string | null;
  onSelectSession: (id: string, flowName: string) => void;
}

function AgentSessionCard({ agentSession, activeSessionId, onSelectSession }: AgentSessionCardProps) {
  const [expanded, setExpanded] = useState(true);
  const hasFlows = agentSession.flowSessions.length > 0;

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden bg-white shadow-sm">
      {/* Agent header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-gray-50 transition-colors"
      >
        <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${statusColor(agentSession.status)}`}>
          <Layers size={11} className={agentSession.status === 'running' || agentSession.status === 'paused' ? 'text-white' : 'text-gray-400'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-700 truncate">{agentSession.agentName}</p>
          <p className="text-[10px] text-gray-300 font-mono">{agentSession.id.slice(0, 12)}… · {timeAgo(agentSession.startedAt)}</p>
        </div>
        <SessionStatusBadge status={agentSession.status as SessionStatus} />
        {hasFlows && (
          expanded
            ? <ChevronDown size={12} className="text-gray-300 flex-shrink-0" />
            : <ChevronRight size={12} className="text-gray-300 flex-shrink-0" />
        )}
      </button>

      {/* Flow sessions */}
      {expanded && hasFlows && (
        <div className="border-t border-gray-50 bg-gray-50/50">
          {agentSession.flowSessions.map((fs) => (
            <FlowSessionRow
              key={fs.id}
              flowSession={fs}
              isActive={fs.id === activeSessionId}
              onSelect={() => onSelectSession(fs.id, fs.flowName)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FlowSessionRowProps {
  flowSession: AgentFlowSession;
  isActive: boolean;
  onSelect: () => void;
}

function FlowSessionRow({ flowSession, isActive, onSelect }: FlowSessionRowProps) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 flex items-center gap-2 border-b border-gray-100 last:border-0 transition-colors ${
        isActive ? 'bg-blue-50' : 'hover:bg-white'
      }`}
    >
      <div className="w-1 self-stretch rounded-full flex-shrink-0 bg-gray-200 ml-1" />
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate ${isActive ? 'text-blue-700' : 'text-gray-600'}`}>{flowSession.flowName}</p>
        <p className="text-[10px] text-gray-300 font-mono">{flowSession.id.slice(0, 12)}… · {timeAgo(flowSession.startedAt)}</p>
      </div>
      <SessionStatusBadge status={flowSession.status as SessionStatus} />
    </button>
  );
}

export function SessionsPanel({ newSession, activeSessionId, onSelectSession }: SessionsPanelProps) {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([]);
  const newSessionRef = useRef<string | null>(null);

  const { data: remoteAgentSessions, refetch } = trpc.getAgentSessions.useQuery(undefined, {
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!remoteAgentSessions) return;
    setAgentSessions(remoteAgentSessions as AgentSession[]);
  }, [remoteAgentSessions]);

  // Track flow-session status changes via subscription
  trpc.streamEvents.useSubscription(
    {},
    {
      onData(event) {
        if (event.type === 'session:statusChange') {
          setAgentSessions((prev) =>
            prev.map((as) => ({
              ...as,
              flowSessions: as.flowSessions.map((fs) =>
                fs.id === event.sessionId ? { ...fs, status: event.to as SessionStatus } : fs,
              ),
            })),
          );
        }
      },
    },
  );

  // Optimistically add new flow session when chat creates one
  useEffect(() => {
    if (!newSession || newSession.sessionId === newSessionRef.current) return;
    newSessionRef.current = newSession.sessionId;
    // Trigger a refetch so the new session appears under its agent session
    refetch();
  }, [newSession, refetch]);

  const filtered =
    filter === 'all'
      ? agentSessions
      : agentSessions.filter((as) => {
          if (as.status === filter) return true;
          return as.flowSessions.some((fs) => fs.status === filter);
        });

  const runningCount = agentSessions.filter((as) => as.status === 'running').length;

  return (
    <aside className="w-72 flex flex-col bg-white/80 backdrop-blur-xl border-l border-gray-200/60 h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-800">Sessions</h3>
          {runningCount > 0 && (
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">
              {runningCount}
            </span>
          )}
        </div>
        <button
          onClick={() => refetch()}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all duration-150"
          title="Refresh sessions"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 px-3 py-2 overflow-x-auto">
        {TABS.map((tab) => {
          const count =
            tab.key === 'all'
              ? agentSessions.length
              : agentSessions.filter((as) => as.status === tab.key).length;
          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150 ${
                filter === tab.key
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span className={`ml-1 ${filter === tab.key ? 'text-white/70' : 'text-gray-300'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
            <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center">
              <Layers size={20} className="text-gray-200" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-300">No sessions</p>
              <p className="text-xs text-gray-200 mt-0.5">
                {filter === 'all' ? 'Start a chat to create a session' : `No ${filter} sessions`}
              </p>
            </div>
          </div>
        ) : (
          filtered.map((as) => (
            <AgentSessionCard
              key={as.id}
              agentSession={as}
              activeSessionId={activeSessionId}
              onSelectSession={onSelectSession}
            />
          ))
        )}
      </div>

      {/* Footer hint */}
      <div className="px-4 py-3 border-t border-gray-100">
        <p className="text-[10px] text-gray-300 text-center leading-relaxed">
          Agent flows run in the background and create sessions automatically
        </p>
      </div>
    </aside>
  );
}
