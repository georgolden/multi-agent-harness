import { SidebarHeader } from './SidebarHeader.js';
import { FeaturesSection } from './FeaturesSection.js';
import { AgentsSection } from './AgentsSection.js';
import type { Agent } from '../../types.js';

interface SidebarProps {
  builtinAgents: Agent[] | undefined;
  schemaAgents: Agent[] | undefined;
  loadingAgents: boolean;
  selectedAgent: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectAgent: (name: string) => void;
  onEditAgent: (name: string) => void;
  onOpenToolkits: () => void;
}

export function Sidebar({
  builtinAgents,
  schemaAgents,
  loadingAgents,
  selectedAgent,
  collapsed,
  onToggleCollapse,
  onSelectAgent,
  onEditAgent,
  onOpenToolkits,
}: SidebarProps) {
  return (
    <aside
      className={`flex flex-col bg-white/80 backdrop-blur-xl border-r border-gray-200/60 transition-all duration-300 ease-in-out h-full ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <SidebarHeader collapsed={collapsed} onToggle={onToggleCollapse} />

      <div className="mx-3 h-px bg-gray-100" />

      <FeaturesSection collapsed={collapsed} onOpenToolkits={onOpenToolkits} />

      {!collapsed && <div className="mx-3 h-px bg-gray-100 my-1" />}

      <AgentsSection
        builtinAgents={builtinAgents}
        schemaAgents={schemaAgents}
        loading={loadingAgents}
        selectedAgent={selectedAgent}
        collapsed={collapsed}
        onSelectAgent={onSelectAgent}
        onEditAgent={onEditAgent}
      />
    </aside>
  );
}
