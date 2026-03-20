import { Play, ChevronRight } from 'lucide-react';
import type { AgentFlow, ParsedFlowDescription } from '../../types.js';

interface FlowCardProps {
  flow: AgentFlow;
  selected: boolean;
  collapsed: boolean;
  onClick: () => void;
}

function parseDescription(raw: string): { text: string; tags: string[] } {
  try {
    const parsed = JSON.parse(raw) as ParsedFlowDescription;
    return {
      text: typeof parsed.summary === 'string' ? parsed.summary : raw,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch {
    return { text: raw, tags: [] };
  }
}

export function FlowCard({ flow, selected, collapsed, onClick }: FlowCardProps) {
  const { text, tags } = parseDescription(flow.description ?? '');
  const initials = flow.name
    .split(/[\s_-]+/)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');

  if (collapsed) {
    return (
      <button
        onClick={onClick}
        title={flow.name}
        className={`w-full flex items-center justify-center py-2.5 mx-auto rounded-xl transition-all duration-150 ${
          selected
            ? 'bg-blue-500 text-white shadow-sm'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        }`}
      >
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold ${
            selected ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {initials}
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 rounded-xl transition-all duration-150 group relative ${
        selected
          ? 'bg-blue-500 shadow-sm'
          : 'hover:bg-gray-50 active:bg-gray-100'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold flex-shrink-0 mt-0.5 ${
            selected ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <p className={`text-sm font-medium truncate ${selected ? 'text-white' : 'text-gray-800'}`}>
              {flow.name}
            </p>
            <ChevronRight
              size={14}
              className={`flex-shrink-0 transition-opacity ${
                selected ? 'text-white/70 opacity-100' : 'text-gray-400 opacity-0 group-hover:opacity-100'
              }`}
            />
          </div>
          {text && (
            <p className={`text-xs mt-0.5 line-clamp-2 ${selected ? 'text-white/70' : 'text-gray-400'}`}>
              {text}
            </p>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                    selected ? 'bg-white/20 text-white/80' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
