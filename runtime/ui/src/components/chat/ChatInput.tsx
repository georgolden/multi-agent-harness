import { useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, loading, placeholder }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled || loading) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const canSend = value.trim().length > 0 && !disabled && !loading;

  return (
    <div className="px-4 py-4 bg-white/70 backdrop-blur-xl border-t border-gray-100">
      <div className="flex items-end gap-2 bg-white rounded-2xl border border-gray-200 shadow-sm px-4 py-2.5 focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100 transition-all duration-150">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          disabled={loading}
          placeholder={placeholder ?? 'Message the agent flow…'}
          className="flex-1 resize-none bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none py-0.5 max-h-40 leading-relaxed disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-150 mb-0.5 ${
            canSend
              ? 'bg-blue-500 text-white hover:bg-blue-600 active:scale-95 shadow-sm'
              : 'bg-gray-100 text-gray-500'
          }`}
        >
          {loading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <ArrowUp size={15} strokeWidth={2.5} />
          )}
        </button>
      </div>
      <p className="text-[10px] text-gray-500 text-center mt-2">
        Press Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}
