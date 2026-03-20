import { Loader2 } from 'lucide-react';
import { FlowCard } from './FlowCard.js';
import type { AgentFlow } from '../../types.js';

interface FlowsSectionProps {
  flows: AgentFlow[] | undefined;
  loading: boolean;
  selectedFlow: string | null;
  collapsed: boolean;
  onSelectFlow: (name: string) => void;
}

export function FlowsSection({ flows, loading, selectedFlow, collapsed, onSelectFlow }: FlowsSectionProps) {
  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      {!collapsed && (
        <p className="text-xs font-medium text-gray-400 uppercase tracking-widest px-1 mb-2">Agent Flows</p>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="text-gray-300 animate-spin" />
        </div>
      )}

      {!loading && (!flows || flows.length === 0) && (
        <div className="text-center py-8 px-2">
          <p className="text-xs text-gray-300">No agent flows found</p>
        </div>
      )}

      {!loading && flows && flows.length > 0 && (
        <div className="flex flex-col gap-1">
          {flows.map((flow) => (
            <FlowCard
              key={flow.name}
              flow={flow}
              selected={selectedFlow === flow.name}
              collapsed={collapsed}
              onClick={() => onSelectFlow(flow.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
