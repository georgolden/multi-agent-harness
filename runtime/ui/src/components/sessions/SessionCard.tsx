import { Clock, BrainCircuit } from 'lucide-react';
import { SessionStatusBadge } from './SessionStatusBadge.js';
import type { AgentFlowSession, SessionStatus } from '../../types.js';

interface SessionCardProps {
  session: AgentFlowSession;
  isNew?: boolean;
  isActive?: boolean;
  onClick?: () => void;
}

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

export function SessionCard({ session, isNew, isActive, onClick }: SessionCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 rounded-xl border transition-all duration-200 shadow-sm ${
        isActive
          ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-100'
          : isNew
          ? 'border-blue-200 bg-blue-50/40 hover:border-blue-300 hover:bg-blue-50'
          : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
              session.status === 'running'
                ? 'bg-gradient-to-br from-blue-500 to-violet-600'
                : 'bg-gray-100'
            }`}
          >
            <BrainCircuit
              size={14}
              className={session.status === 'running' ? 'text-white' : 'text-gray-400'}
            />
          </div>
          <p className="text-sm font-medium text-gray-800 truncate">{session.flowName}</p>
        </div>
        <SessionStatusBadge status={session.status as SessionStatus} />
      </div>

      <div className="flex items-center gap-1 mt-2 ml-9">
        <Clock size={10} className="text-gray-300 flex-shrink-0" />
        <span className="text-[11px] text-gray-300">{timeAgo(session.startedAt)}</span>
      </div>

      {session.id && (
        <p className="text-[10px] text-gray-200 mt-1 ml-9 font-mono truncate">{session.id.slice(0, 16)}…</p>
      )}
    </button>
  );
}
