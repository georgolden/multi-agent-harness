import type { SessionStatus } from '../../types.js';

const STATUS_CONFIG: Record<
  SessionStatus,
  { label: string; dot: string; text: string; bg: string }
> = {
  running: {
    label: 'Running',
    dot: 'bg-green-400 animate-pulse',
    text: 'text-green-700',
    bg: 'bg-green-50',
  },
  created: {
    label: 'Created',
    dot: 'bg-blue-400',
    text: 'text-blue-700',
    bg: 'bg-blue-50',
  },
  paused: {
    label: 'Paused',
    dot: 'bg-amber-400',
    text: 'text-amber-700',
    bg: 'bg-amber-50',
  },
  completed: {
    label: 'Completed',
    dot: 'bg-gray-300',
    text: 'text-gray-500',
    bg: 'bg-gray-50',
  },
  failed: {
    label: 'Failed',
    dot: 'bg-red-400',
    text: 'text-red-700',
    bg: 'bg-red-50',
  },
};

interface SessionStatusBadgeProps {
  status: SessionStatus;
}

export function SessionStatusBadge({ status }: SessionStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.created;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${config.bg} ${config.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
