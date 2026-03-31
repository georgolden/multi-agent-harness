import { BrainCircuit } from 'lucide-react';
import type { AgentFlowSession } from '../../types.js';

interface ChatHeaderProps {
  agentName: string | null;
  flowSessions: AgentFlowSession[];
  activeSessionId: string | null | undefined;
  onSelectSession: (id: string, flowName: string) => void;
}

const STATUS_DOT: Record<string, string> = {
  running: 'bg-green-400',
  paused: 'bg-yellow-400',
  failed: 'bg-red-400',
  completed: 'bg-gray-300',
  created: 'bg-gray-300',
};

export function ChatHeader({ agentName, flowSessions, activeSessionId, onSelectSession }: ChatHeaderProps) {
  return (
    <div className="border-b border-gray-100 bg-white/70 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-6 py-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-sm flex-shrink-0">
          <BrainCircuit size={18} className="text-white" />
        </div>
        <div>
          <p className="text-[10px] font-medium text-gray-600 uppercase tracking-widest leading-none mb-0.5">Agent</p>
          {agentName && <h2 className="text-base font-semibold text-gray-900 leading-tight">{agentName}</h2>}
        </div>
      </div>

      {flowSessions.length > 0 && (
        <div className="flex gap-1 px-4 pb-2 overflow-x-auto scrollbar-none">
          {flowSessions.map((fs) => {
            const isActive = fs.id === activeSessionId;
            const dot = STATUS_DOT[fs.status] ?? 'bg-gray-300';
            return (
              <button
                key={fs.id}
                onClick={() => onSelectSession(fs.id, fs.flowName)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 border ${
                  isActive
                    ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-white/70' : dot}`} />
                {fs.flowName}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
