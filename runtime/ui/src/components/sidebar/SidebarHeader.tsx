import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

interface SidebarHeaderProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function SidebarHeader({ collapsed, onToggle }: SidebarHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-4">
      {!collapsed && (
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-gray-900">AGI Runtime</h1>
          <p className="text-xs text-gray-600 mt-0.5">Agents</p>
        </div>
      )}
      <button
        onClick={onToggle}
        className="flex items-center justify-center w-8 h-8 rounded-xl text-gray-600 hover:text-gray-700 hover:bg-gray-100 transition-all duration-150 ml-auto"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>
    </div>
  );
}
