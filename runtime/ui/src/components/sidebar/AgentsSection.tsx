import { Loader2 } from 'lucide-react';
import { AgentCard } from './AgentCard.js';
import type { Agent } from '../../types.js';

interface AgentsSectionProps {
  builtinAgents: Agent[] | undefined;
  schemaAgents: Agent[] | undefined;
  loading: boolean;
  selectedAgent: string | null;
  collapsed: boolean;
  onSelectAgent: (name: string) => void;
  onEditAgent: (name: string) => void;
}

export function AgentsSection({
  builtinAgents,
  schemaAgents,
  loading,
  selectedAgent,
  collapsed,
  onSelectAgent,
  onEditAgent,
}: AgentsSectionProps) {
  const hasBuiltin = builtinAgents && builtinAgents.length > 0;
  const hasSchema = schemaAgents && schemaAgents.length > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="text-gray-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
      {/* Built-in agents */}
      {hasBuiltin && (
        <div>
          {!collapsed && (
            <p className="text-xs font-medium text-gray-600 uppercase tracking-widest px-1 mb-2">Agents</p>
          )}
          <div className="flex flex-col gap-1">
            {builtinAgents!.map((agent) => (
              <AgentCard
                key={agent.name}
                agent={agent}
                selected={selectedAgent === agent.name}
                collapsed={collapsed}
                onClick={() => onSelectAgent(agent.name)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Schema agents */}
      {hasSchema && (
        <div>
          {!collapsed && (
            <p className="text-xs font-medium text-gray-600 uppercase tracking-widest px-1 mb-2 mt-1">
              Schema Agents
            </p>
          )}
          <div className="flex flex-col gap-1">
            {schemaAgents!.map((agent) => (
              <AgentCard
                key={agent.name}
                agent={agent}
                selected={selectedAgent === agent.name}
                collapsed={collapsed}
                editable
                onClick={() => onSelectAgent(agent.name)}
                onEdit={() => onEditAgent(agent.name)}
              />
            ))}
          </div>
        </div>
      )}

      {!hasBuiltin && !hasSchema && (
        <div className="text-center py-8 px-2">
          <p className="text-xs text-gray-500">No agents found</p>
        </div>
      )}
    </div>
  );
}
