import type { ChatMessage } from '../../types.js';

interface ChatBubbleProps {
  message: ChatMessage;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0 shadow-sm">
          <span className="text-white text-[10px] font-bold">AI</span>
        </div>
      )}
      <div className={`max-w-[72%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? 'bg-blue-500 text-white rounded-br-md shadow-sm'
              : 'bg-white text-gray-800 rounded-bl-md shadow-sm border border-gray-100'
          }`}
        >
          {message.content}
        </div>
        <span className="text-[10px] text-gray-300 px-1">{formatTime(message.timestamp)}</span>
      </div>
    </div>
  );
}
