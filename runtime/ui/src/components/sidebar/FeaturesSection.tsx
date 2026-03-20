import { Zap, BrainCircuit, Workflow } from 'lucide-react';

const FEATURES = [
  { icon: BrainCircuit, label: 'AI Agents', color: 'text-violet-500', bg: 'bg-violet-50' },
  { icon: Workflow, label: 'Flows', color: 'text-blue-500', bg: 'bg-blue-50' },
  { icon: Zap, label: 'Real-time', color: 'text-amber-500', bg: 'bg-amber-50' },
];

interface FeaturesSectionProps {
  collapsed: boolean;
}

export function FeaturesSection({ collapsed }: FeaturesSectionProps) {
  if (collapsed) return null;

  return (
    <div className="px-3 py-2">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-widest px-1 mb-2">Features</p>
      <div className="flex gap-2">
        {FEATURES.map(({ icon: Icon, label, color, bg }) => (
          <div
            key={label}
            className={`flex flex-col items-center gap-1 flex-1 py-2 px-1 rounded-xl ${bg} opacity-60`}
          >
            <Icon size={16} className={color} />
            <span className="text-xs text-gray-500 font-medium leading-none">{label}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-300 text-center mt-2">More features coming soon</p>
    </div>
  );
}
