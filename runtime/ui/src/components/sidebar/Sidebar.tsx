import { SidebarHeader } from './SidebarHeader.js';
import { FeaturesSection } from './FeaturesSection.js';
import { FlowsSection } from './FlowsSection.js';
import type { AgentFlow } from '../../types.js';

interface SidebarProps {
  flows: AgentFlow[] | undefined;
  loadingFlows: boolean;
  selectedFlow: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectFlow: (name: string) => void;
}

export function Sidebar({
  flows,
  loadingFlows,
  selectedFlow,
  collapsed,
  onToggleCollapse,
  onSelectFlow,
}: SidebarProps) {
  return (
    <aside
      className={`flex flex-col bg-white/80 backdrop-blur-xl border-r border-gray-200/60 transition-all duration-300 ease-in-out h-full ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <SidebarHeader collapsed={collapsed} onToggle={onToggleCollapse} />

      <div className="mx-3 h-px bg-gray-100" />

      <FeaturesSection collapsed={collapsed} />

      {!collapsed && <div className="mx-3 h-px bg-gray-100 my-1" />}

      <FlowsSection
        flows={flows}
        loading={loadingFlows}
        selectedFlow={selectedFlow}
        collapsed={collapsed}
        onSelectFlow={onSelectFlow}
      />
    </aside>
  );
}
