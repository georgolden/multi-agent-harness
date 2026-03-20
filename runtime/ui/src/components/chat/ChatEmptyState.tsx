import { BrainCircuit } from 'lucide-react';

interface ChatEmptyStateProps {
  flowName?: string;
}

export function ChatEmptyState({ flowName }: ChatEmptyStateProps) {
  if (!flowName) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
          <BrainCircuit size={28} className="text-gray-300" />
        </div>
        <div>
          <p className="text-base font-semibold text-gray-400">No Agent Flow Selected</p>
          <p className="text-sm text-gray-300 mt-1">Select an agent flow from the sidebar to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-md">
        <BrainCircuit size={28} className="text-white" />
      </div>
      <div>
        <p className="text-base font-semibold text-gray-700">Start a conversation</p>
        <p className="text-sm text-gray-400 mt-1 max-w-xs">
          Send a message to launch <span className="font-medium text-gray-600">{flowName}</span> agent flow
        </p>
      </div>
    </div>
  );
}
