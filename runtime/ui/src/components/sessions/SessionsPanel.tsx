import { useEffect, useRef, useState } from 'react';
import { Layers, RefreshCw } from 'lucide-react';
import { trpc } from '../../trpcClient.js';
import { SessionCard } from './SessionCard.js';
import type { AgentFlowSession, SessionStatus } from '../../types.js';

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

export function SessionsPanel({ newSession, activeSessionId, onSelectSession }: SessionsPanelProps) {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [localSessions, setLocalSessions] = useState<AgentFlowSession[]>([]);
  const newSessionRef = useRef<string | null>(null);

  const { data: remoteSessions, refetch } = trpc.getUserSessions.useQuery(undefined, {
    refetchInterval: 5000,
  });

  // Merge remote sessions
  useEffect(() => {
    if (!remoteSessions) return;
    const remote = (remoteSessions as AgentFlowSession[]).map((s) => ({
      ...s,
      startedAt: s.startedAt ?? new Date(),
    }));
    setLocalSessions(remote);
  }, [remoteSessions]);

  // Track status changes via subscription
  trpc.streamEvents.useSubscription(
    {},
    {
      onData(event) {
        if (event.type === 'session:statusChange') {
          setLocalSessions((prev) =>
            prev.map((s) =>
              s.id === event.sessionId ? { ...s, status: event.to as SessionStatus } : s,
            ),
          );
        }
      },
    },
  );

  // Add new session optimistically when chat creates one
  useEffect(() => {
    if (!newSession || newSession.sessionId === newSessionRef.current) return;
    newSessionRef.current = newSession.sessionId;
    setLocalSessions((prev) => {
      if (prev.find((s) => s.id === newSession.sessionId)) return prev;
      const entry: AgentFlowSession = {
        id: newSession.sessionId,
        userId: '',
        flowName: newSession.flowName,
        status: 'running',
        startedAt: new Date(),
      };
      return [entry, ...prev];
    });
  }, [newSession]);

  const filtered =
    filter === 'all' ? localSessions : localSessions.filter((s) => s.status === filter);

  const runningCount = localSessions.filter((s) => s.status === 'running').length;

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
              ? localSessions.length
              : localSessions.filter((s) => s.status === tab.key).length;
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
                <span
                  className={`ml-1 ${
                    filter === tab.key ? 'text-white/70' : 'text-gray-300'
                  }`}
                >
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
                {filter === 'all'
                  ? 'Start a chat to create a session'
                  : `No ${filter} sessions`}
              </p>
            </div>
          </div>
        ) : (
          filtered.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              isNew={session.id === newSession?.sessionId}
              isActive={session.id === activeSessionId}
              onClick={() => onSelectSession(session.id, session.flowName)}
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
