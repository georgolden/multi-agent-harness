import { useEffect, useRef, useState } from 'react';
import { Layers, RefreshCw, ChevronDown, ChevronUp, X, Check, MinusCircle } from 'lucide-react';
import { trpc } from '../../trpcClient.js';
import { SessionStatusBadge } from './SessionStatusBadge.js';
import type { AgentSession, AgentStatus, SessionStatus } from '../../types.js';

interface NewSessionEntry {
  sessionId: string;
  flowName: string;
}

interface SessionsPanelProps {
  newSession: NewSessionEntry | null;
  activeSessionId: string | null;
  onSelectSession: (agentSession: AgentSession, flowSessionId: string) => void;
}

type FilterTab = 'all' | 'running' | 'completed' | 'paused' | 'failed';


const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'paused', label: 'Paused' },
  { key: 'completed', label: 'Done' },
  { key: 'failed', label: 'Failed' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

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

function agentSortOrder(as: AgentSession): number {
  if (as.status === 'paused') return 0;
  if (as.status === 'running') return 1;
  return 2;
}

interface AgentSessionCardProps {
  agentSession: AgentSession;
  activeSessionId: string | null;
  onSelectSession: (agentSession: AgentSession, flowSessionId: string) => void;
  onDeleted: (agentSessionId: string) => void;
}

function AgentSessionCard({ agentSession, activeSessionId, onSelectSession, onDeleted }: AgentSessionCardProps) {
  const hasFlows = agentSession.flowSessions.length > 0;
  const isAnyFlowActive = agentSession.flowSessions.some((fs) => fs.id === activeSessionId);

  const [expanded, setExpanded] = useState(isAnyFlowActive);
  const [confirming, setConfirming] = useState(false);

  const deleteSession = trpc.deleteAgentSession.useMutation({
    onSuccess: () => onDeleted(agentSession.id),
  });

  // Pick first flow session as default when clicking the agent row
  function handleAgentClick() {
    if (confirming) return;
    if (!hasFlows) return;
    const first = agentSession.flowSessions[0];
    onSelectSession(agentSession, first.id);
    setExpanded(true);
  }

  return (
    <div className="border border-gray-100 rounded-xl bg-white shadow-sm">
      {/* Agent row — click opens first flow */}
      <button
        onClick={handleAgentClick}
        className={`w-full px-3 py-2.5 flex items-center gap-2 transition-colors rounded-t-xl ${
          confirming ? 'bg-red-50' : isAnyFlowActive ? 'bg-blue-50' : 'hover:bg-gray-50'
        }`}
      >
        <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${statusColor(agentSession.status)}`}>
          <Layers size={11} className={agentSession.status === 'running' || agentSession.status === 'paused' ? 'text-white' : 'text-gray-600'} />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className={`text-xs font-semibold truncate ${confirming ? 'text-red-600' : isAnyFlowActive ? 'text-blue-700' : 'text-gray-700'}`}>{agentSession.agentName}</p>
          <p className={`text-[10px] ${confirming ? 'text-red-400' : 'text-gray-600'}`}>{confirming ? 'Delete session?' : timeAgo(agentSession.startedAt)}</p>
        </div>

        {confirming ? (
          <>
            <span
              onClick={(e) => { e.stopPropagation(); deleteSession.mutate({ agentSessionId: agentSession.id }); }}
              title="Confirm delete"
              className="w-6 h-6 flex items-center justify-center rounded-md bg-green-100 hover:bg-green-200 text-green-600 hover:text-green-700 transition-all duration-150 flex-shrink-0"
            >
              <Check size={13} />
            </span>
            <span
              onClick={(e) => { e.stopPropagation(); setConfirming(false); }}
              title="Cancel"
              className="w-6 h-6 flex items-center justify-center rounded-md bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-all duration-150 flex-shrink-0"
            >
              <MinusCircle size={13} />
            </span>
          </>
        ) : (
          <>
            <SessionStatusBadge status={agentSession.status as SessionStatus} />
            <span
              onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
              title="Delete session"
              className="w-6 h-6 flex items-center justify-center rounded-md text-gray-500 hover:bg-red-50 hover:text-red-400 transition-all duration-150 flex-shrink-0"
            >
              <X size={13} />
            </span>
            {hasFlows && (
              <span
                onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                className="w-6 h-6 flex items-center justify-center rounded-md bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-all duration-150 flex-shrink-0"
              >
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </span>
            )}
          </>
        )}
      </button>

      {/* Flow session rows — capped at 5 visible rows, scrollable beyond */}
      {expanded && hasFlows && (
        <div className="border-t border-gray-100 bg-gray-50/50 rounded-b-xl overflow-y-auto" style={{ maxHeight: '280px' }}>
          {agentSession.flowSessions.map((fs) => (
            <button
              key={fs.id}
              onClick={() => onSelectSession(agentSession, fs.id)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 border-b border-gray-100 last:border-0 transition-colors ${
                fs.id === activeSessionId ? 'bg-blue-50' : 'hover:bg-white'
              }`}
            >
              <div className="w-1 self-stretch rounded-full flex-shrink-0 bg-gray-200 ml-1" />
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium truncate ${fs.id === activeSessionId ? 'text-blue-700' : 'text-gray-600'}`}>{fs.flowName}</p>
                <p className="text-[10px] text-gray-600">{timeAgo(fs.startedAt)}</p>
              </div>
              <SessionStatusBadge status={fs.status as SessionStatus} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SessionsPanel({ newSession, activeSessionId, onSelectSession }: SessionsPanelProps) {
  const [filter, setFilter] = useState<FilterTab>('all');
  // All accumulated sessions across loaded windows
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([]);
  // How many full 24h windows back we've loaded (0 = current window only)
  const [windowsLoaded, setWindowsLoaded] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const newSessionRef = useRef<string | null>(null);
  // Anchor so window boundaries don't shift while the panel is open
  const mountedAt = useRef(Date.now()).current;

  // Current window: (mountedAt - 24h, +∞) — no upper cap so new sessions appear
  const currentWindowFrom = new Date(mountedAt - DAY_MS).toISOString();
  const { data: currentWindowData, refetch } = trpc.getAgentSessions.useQuery(
    { from: currentWindowFrom },
    { refetchInterval: 5000 },
  );

  // Merge current window data into state (replaces any existing current-window sessions)
  useEffect(() => {
    if (!currentWindowData) return;
    const incoming = currentWindowData as AgentSession[];
    setAgentSessions((prev) => {
      // Remove sessions that fall in the current window, replace with fresh data
      const cutoff = new Date(currentWindowFrom).getTime();
      const historical = prev.filter((s) => new Date(s.startedAt).getTime() < cutoff);
      return [...incoming, ...historical];
    });
  }, [currentWindowData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Status updates from subscription — update status optimistically and refetch for new sessions
  trpc.streamEvents.useSubscription(
    {},
    {
      onData(event) {
        if (event.type === 'session:statusChange') {
          setAgentSessions((prev) =>
            prev.map((as) => {
              const updatedFlowSessions = as.flowSessions.map((fs) =>
                fs.id === event.sessionId ? { ...fs, status: event.to as SessionStatus } : fs,
              );
              const allDone = updatedFlowSessions.length > 0 && updatedFlowSessions.every((fs) => fs.status === 'completed' || fs.status === 'failed');
              const anyFailed = updatedFlowSessions.some((fs) => fs.status === 'failed');
              const agentStatus = allDone ? (anyFailed ? 'failed' : 'completed') : as.status;
              return { ...as, status: agentStatus as typeof as.status, flowSessions: updatedFlowSessions };
            }),
          );
          // Refetch to pick up any new flow sessions spawned during the run
          void refetch();
        }
        if (event.type === 'session:message:update') {
          void refetch();
        }
      },
    },
  );

  useEffect(() => {
    if (!newSession || newSession.sessionId === newSessionRef.current) return;
    newSessionRef.current = newSession.sessionId;
    refetch().then((result) => {
      if (!result.data) return;
      const sessions = result.data as AgentSession[];
      // Find the agent session that contains the new flow session and auto-select it
      for (const as of sessions) {
        const fs = as.flowSessions.find((f) => f.id === newSession.sessionId);
        if (fs) {
          onSelectSession(as, fs.id);
          break;
        }
      }
    });
  }, [newSession, refetch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the next 24h window on demand using the tRPC utils
  const utils = trpc.useUtils();

  async function loadMoreHistory() {
    setLoadingMore(true);
    const nextWindow = windowsLoaded + 1;
    // Window N covers (mountedAt - (N+1)*24h, mountedAt - N*24h)
    const from = new Date(mountedAt - (nextWindow + 1) * DAY_MS).toISOString();
    const to = new Date(mountedAt - nextWindow * DAY_MS).toISOString();
    try {
      const data = await utils.getAgentSessions.fetch({ from, to });
      const incoming = data as AgentSession[];
      if (incoming.length > 0) {
        setAgentSessions((prev) => {
          const existingIds = new Set(prev.map((s) => s.id));
          return [...prev, ...incoming.filter((s) => !existingIds.has(s.id))];
        });
      }
      setWindowsLoaded(nextWindow);
    } finally {
      setLoadingMore(false);
    }
  }

  const sorted = agentSessions.slice().sort((a, b) => {
    const orderDiff = agentSortOrder(a) - agentSortOrder(b);
    if (orderDiff !== 0) return orderDiff;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });

  const filtered =
    filter === 'all'
      ? sorted
      : sorted.filter((as) => {
          if (as.status === filter) return true;
          return as.flowSessions.some((fs) => fs.status === filter);
        });

  const tabCount = (key: FilterTab) =>
    key === 'all'
      ? sorted.length
      : sorted.filter((as) => as.status === key || as.flowSessions.some((fs) => fs.status === key)).length;

  const runningCount = agentSessions.filter((as) => as.status === 'running').length;

  return (
    <aside className="w-72 flex flex-col bg-white/80 backdrop-blur-xl border-l border-gray-200/60 h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-gray-600" />
          <h3 className="text-sm font-semibold text-gray-800">Sessions</h3>
          {runningCount > 0 && (
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">
              {runningCount}
            </span>
          )}
        </div>
        <button
          onClick={() => refetch()}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-600 hover:text-gray-700 hover:bg-gray-100 transition-all duration-150"
          title="Refresh sessions"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 px-3 py-2 overflow-x-auto">
        {TABS.map((tab) => {
          const count = tabCount(tab.key);
          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150 ${
                filter === tab.key
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-600 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span className={`ml-1 ${filter === tab.key ? 'text-white/70' : 'text-gray-500'}`}>
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
              <Layers size={20} className="text-gray-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">No sessions</p>
              <p className="text-xs text-gray-600 mt-0.5">
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
              onDeleted={(id) => setAgentSessions((prev) => prev.filter((s) => s.id !== id))}
            />
          ))
        )}
        <button
          onClick={loadMoreHistory}
          disabled={loadingMore}
          className="w-full py-2 text-xs text-gray-600 hover:text-gray-700 hover:bg-gray-50 rounded-xl border border-dashed border-gray-200 hover:border-gray-300 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loadingMore ? 'Loading…' : 'Show previous 24 hours'}
        </button>
      </div>

      {/* Footer hint */}
      <div className="px-4 py-3 border-t border-gray-100">
        <p className="text-[10px] text-gray-500 text-center leading-relaxed">
          Agents run in the background and create sessions automatically
        </p>
      </div>
    </aside>
  );
}
