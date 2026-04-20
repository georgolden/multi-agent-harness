import { Plug } from 'lucide-react';

interface FeaturesSectionProps {
  collapsed: boolean;
  onOpenToolkits: () => void;
}

export function FeaturesSection({ collapsed, onOpenToolkits }: FeaturesSectionProps) {
  if (collapsed) {
    return (
      <div className="px-3 py-2 flex justify-center">
        <button
          onClick={onOpenToolkits}
          className="p-2 rounded-xl text-gray-500 hover:text-violet-600 hover:bg-violet-50 transition-colors"
          title="Toolkits"
        >
          <Plug size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <p className="text-xs font-medium text-gray-600 uppercase tracking-widest px-1 mb-2">Toolkits</p>
      <button
        onClick={onOpenToolkits}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-50 hover:bg-violet-100 text-violet-700 text-sm font-medium transition-colors"
      >
        <Plug size={15} />
        Connect tools
      </button>
    </div>
  );
}
