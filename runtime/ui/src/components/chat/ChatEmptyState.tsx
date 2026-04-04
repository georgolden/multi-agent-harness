import { BrainCircuit } from 'lucide-react';
import type { ParsedFlowDescription } from '../../types.js';

interface ChatEmptyStateProps {
  flowName?: string;
  description?: string | null;
}

function parseDescription(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as ParsedFlowDescription;
    return typeof parsed.summary === 'string' ? parsed.summary : raw;
  } catch {
    return raw;
  }
}

export function ChatEmptyState({ flowName, description }: ChatEmptyStateProps) {
  if (!flowName) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
          <BrainCircuit size={28} className="text-gray-500" />
        </div>
        <div>
          <p className="text-base font-semibold text-gray-600">No Agent Selected</p>
          <p className="text-sm text-gray-500 mt-1">Select an agent from the sidebar to get started</p>
        </div>
      </div>
    );
  }

  const descriptionText = description ? parseDescription(description) : null;

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-md">
        <BrainCircuit size={28} className="text-white" />
      </div>
      <div className="max-w-sm">
        <p className="text-base font-semibold text-gray-700">
          {flowName}
        </p>
        {descriptionText && (
          <p className="text-sm text-gray-600 mt-1.5">{descriptionText}</p>
        )}
        <p className="text-sm text-gray-500 mt-3">
          Send a message to start this agent
        </p>
      </div>
    </div>
  );
}
