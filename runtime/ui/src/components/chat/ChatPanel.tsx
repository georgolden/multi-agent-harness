import { useEffect, useRef, useState } from 'react';
import { trpc } from '../../trpcClient.js';
import { ChatHeader } from './ChatHeader.js';
import { ChatBubble } from './ChatBubble.js';
import { ChatInput } from './ChatInput.js';
import { ChatEmptyState } from './ChatEmptyState.js';
import type { ChatMessage } from '../../types.js';

interface ChatPanelProps {
  selectedFlow: string | null;
  selectedSession: { id: string; flowName: string } | null;
  onSessionCreated: (sessionId: string, flowName: string) => void;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'object' && part !== null && 'text' in part ? (part as { text: string }).text : ''))
      .join('');
  }
  return '';
}

export function ChatPanel({ selectedFlow, selectedSession, onSessionCreated }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const runFlow = trpc.runFlow.useMutation();
  const sendMessage = trpc.sendMessage.useMutation();

  // Load history when a session is selected from the right panel
  const { data: sessionData } = trpc.getSession.useQuery(
    { sessionId: selectedSession?.id ?? '' },
    { enabled: !!selectedSession?.id },
  );

  useEffect(() => {
    if (!sessionData) return;
    const data = sessionData as { messages?: Array<{ message: { role: string; content: unknown }; timestamp: string }> };
    const history: ChatMessage[] = (data.messages ?? [])
      .filter((m) => m.message.role === 'user' || m.message.role === 'assistant')
      .map((m, i) => ({
        id: `history-${i}`,
        role: m.message.role as 'user' | 'assistant',
        content: extractText(m.message.content),
        timestamp: new Date(m.timestamp),
      }))
      .filter((m) => m.content.length > 0);
    setMessages(history);
    setSessionId(selectedSession?.id ?? null);
  }, [sessionData, selectedSession?.id]);

  // Subscribe to events for current session
  trpc.streamEvents.useSubscription(
    { sessionId: sessionId ?? undefined },
    {
      enabled: !!sessionId,
      onData(event) {
        if (event.type === 'session:message') {
          setMessages((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random()}`,
              role: 'assistant',
              content: event.message,
              timestamp: new Date(),
            },
          ]);
        }
      },
    },
  );

  // Reset when flow changes via sidebar (selectedSession will be null)
  useEffect(() => {
    if (selectedSession) return;
    setMessages([]);
    setSessionId(null);
  }, [selectedFlow, selectedSession]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text: string) => {
    if (!selectedFlow || sending) return;

    const userMsg: ChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    try {
      if (!sessionId) {
        const result = await runFlow.mutateAsync({ flowName: selectedFlow, message: text });
        setSessionId(result.sessionId);
        onSessionCreated(result.sessionId, selectedFlow);
      } else {
        await sendMessage.mutateAsync({ sessionId, message: text });
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-err`,
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="flex flex-col flex-1 h-full bg-gray-50/50 min-w-0">
      {selectedFlow ? (
        <>
          <ChatHeader flowName={selectedFlow} />
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <ChatEmptyState flowName={selectedFlow} />
            ) : (
              <>
                {messages.map((msg) => (
                  <ChatBubble key={msg.id} message={msg} />
                ))}
                <div ref={bottomRef} />
              </>
            )}
          </div>
          <ChatInput onSend={handleSend} loading={sending} />
        </>
      ) : (
        <ChatEmptyState />
      )}
    </main>
  );
}
