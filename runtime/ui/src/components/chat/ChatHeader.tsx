import { BrainCircuit } from 'lucide-react';

interface ChatHeaderProps {
  flowName: string;
}

export function ChatHeader({ flowName }: ChatHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-white/70 backdrop-blur-xl">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-sm">
        <BrainCircuit size={18} className="text-white" />
      </div>
      <div>
        <p className="text-xs font-medium text-gray-400 uppercase tracking-widest leading-none mb-0.5">Agent Flow</p>
        <h2 className="text-base font-semibold text-gray-900 leading-tight">{flowName}</h2>
      </div>
    </div>
  );
}
