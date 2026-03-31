import { useEffect, useRef, useState } from 'react';
import { X, Copy, Check, FileText } from 'lucide-react';
import { trpc } from '../../trpcClient.js';
import { ChatHeader } from './ChatHeader.js';
import { ChatBubble } from './ChatBubble.js';
import { ChatInput } from './ChatInput.js';
import { ChatEmptyState } from './ChatEmptyState.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import type { ChatMessage, TempFile, ToolCallInfo } from '../../types.js';
import type { AgentFlowSession } from '../../types.js';

interface ChatPanelProps {
  selectedFlow: string | null;
  selectedSession: { id: string; flowName: string } | null;
  onSessionCreated: (sessionId: string, flowName: string) => void;
  onSelectFlowSession: (flowSessionId: string) => void;
  flowDescription: string | null;
  agentName: string | null;
  flowSessions: AgentFlowSession[];
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'object' && p !== null && 'text' in p ? (p as { text: string }).text : ''))
      .join('');
  }
  return '';
}

function parseUserMessage(raw: string): { text: string; tempFiles: TempFile[] } {
  const tempFiles: TempFile[] = [];
  let remaining = raw;
  const tempFilesMatch = raw.match(/^<temp_files>([\s\S]*?)<\/temp_files>\n?/);
  if (tempFilesMatch) {
    remaining = raw.slice(tempFilesMatch[0].length);
    const fileRegex = /<file>\s*<name>([\s\S]*?)<\/name>\s*<content>([\s\S]*?)<\/content>\s*<\/file>/g;
    let m;
    while ((m = fileRegex.exec(tempFilesMatch[1])) !== null) {
      tempFiles.push({ name: m[1].trim(), content: m[2] });
    }
  }
  const msgMatch = remaining.match(/^<user_message>([\s\S]*)<\/user_message>$/);
  return { text: msgMatch ? msgMatch[1] : remaining, tempFiles };
}

type RawMessage = { message: { role: string; content: unknown; tool_calls?: unknown; tool_call_id?: string }; timestamp: string };

function parseMessages(rawMessages: RawMessage[], tempFiles: TempFile[]): ChatMessage[] {
  const msgs: ChatMessage[] = [];

  // First pass: collect tool_call messages indexed by tool call id → message index
  // so tool_result messages can be attached as result on the tool_call entry
  const toolCallMsgByCallId = new Map<string, ChatMessage>();

  for (let i = 0; i < rawMessages.length; i++) {
    const m = rawMessages[i];
    const { role, content, tool_calls, tool_call_id } = m.message;
    const ts = new Date(m.timestamp);

    if (role === 'system') continue;

    if (role === 'user') {
      const { text, tempFiles: tf } = parseUserMessage(extractText(content));
      if (!text) continue;
      // Only attach tempFiles to the first user message (they come from session)
      const attachFiles = msgs.length === 0 && tempFiles.length > 0 ? tempFiles : tf;
      msgs.push({ id: `msg-${i}`, role: 'user', content: text, tempFiles: attachFiles.length > 0 ? attachFiles : undefined, timestamp: ts });
      continue;
    }

    if (role === 'assistant') {
      if (tool_calls && Array.isArray(tool_calls) && tool_calls.length > 0) {
        const rawCalls = tool_calls as Array<{ id: string; function: { name: string; arguments: string } }>;
        // submit_result is a terminal tool — render it as a result message, not a tool call
        const submitCall = rawCalls.find((tc) => tc.function.name === 'submit_result');
        if (submitCall) {
          const resultData = (() => { try { return JSON.parse(submitCall.function.arguments) as Record<string, unknown>; } catch { return {}; } })();
          msgs.push({ id: `msg-${i}`, role: 'result', content: '', resultData, timestamp: ts });
          continue;
        }
        const calls: ToolCallInfo[] = rawCalls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          args: (() => { try { return JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { return {}; } })(),
        }));
        const msg: ChatMessage = { id: `msg-${i}`, role: 'tool_call', content: extractText(content), toolCalls: calls, timestamp: ts };
        msgs.push(msg);
        for (const tc of calls) toolCallMsgByCallId.set(tc.id, msg);
        continue;
      }
      const text = extractText(content);
      if (text) msgs.push({ id: `msg-${i}`, role: 'assistant', content: text, timestamp: ts });
      continue;
    }

    if (role === 'tool' && tool_call_id) {
      const resultText = extractText(content);
      // Attach result to the parent tool_call message's toolCalls entry
      const parent = toolCallMsgByCallId.get(tool_call_id as string);
      if (parent?.toolCalls) {
        const tc = parent.toolCalls.find((c) => c.id === tool_call_id);
        if (tc) { tc.result = resultText; continue; }
      }
      // Fallback: standalone tool result message
      msgs.push({ id: `msg-${i}`, role: 'tool_result', content: resultText, toolCallId: tool_call_id as string, timestamp: ts });
    }
  }

  return msgs;
}

export function ChatPanel({ selectedFlow, selectedSession, onSessionCreated, onSelectFlowSession, flowDescription, agentName, flowSessions }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [waitingForResponse, setWaitingForResponse] = useState(false);
  const [sending, setSending] = useState(false);
  const [sessionTempFiles, setSessionTempFiles] = useState<TempFile[]>([]);
  const [openTempFile, setOpenTempFile] = useState<TempFile | null>(null);
  const [activeTempFileName, setActiveTempFileName] = useState<string | null>(null);
  const [fileDialogRaw, setFileDialogRaw] = useState(false);
  const [fileCopied, setFileCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const copyFile = (content: string) => {
    void navigator.clipboard.writeText(content).then(() => {
      setFileCopied(true);
      setTimeout(() => setFileCopied(false), 1500);
    });
  };

  const runFlow = trpc.runFlow.useMutation();
  const sendMessage = trpc.sendMessage.useMutation();
  const utils = trpc.useUtils();

  const activeFlowSessionId = selectedSession?.id ?? sessionId;

  const { data: sessionData } = trpc.getSession.useQuery(
    { sessionId: activeFlowSessionId ?? '' },
    { enabled: !!activeFlowSessionId },
  );

  useEffect(() => {
    if (!sessionData) return;
    const data = sessionData as { messages?: RawMessage[]; tempFiles?: TempFile[] };
    const tempFiles = data.tempFiles ?? [];
    const parsed = parseMessages(data.messages ?? [], tempFiles);
    setMessages(parsed);
    setSessionTempFiles(tempFiles);
    setSessionId(activeFlowSessionId);
    setWaitingForResponse(false);
  }, [sessionData, activeFlowSessionId]);

  trpc.streamEvents.useSubscription(
    { sessionId: sessionId ?? undefined },
    {
      enabled: !!sessionId,
      onData(event) {
        console.log('[ChatPanel] streamEvents onData', event);
        if (event.type === 'session:message') {
          setWaitingForResponse(false);
          setMessages((prev) => [
            ...prev,
            { id: `${Date.now()}-${Math.random()}`, role: 'assistant', content: event.message, timestamp: new Date() },
          ]);
        }
        if (event.type === 'session:message:update') {
          console.log('[ChatPanel] session:message:update — refetching session', sessionId);
          void utils.getSession.invalidate({ sessionId: sessionId ?? '' });
        }
        if (event.type === 'session:statusChange') {
          const e = event as { type: string; to: string };
          if (e.to === 'completed' || e.to === 'failed') setWaitingForResponse(false);
        }
      },
    },
  );

  useEffect(() => {
    if (selectedSession) return;
    setMessages([]);
    setSessionId(null);
    setSessionTempFiles([]);
    setWaitingForResponse(false);
  }, [selectedFlow, selectedSession]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, waitingForResponse]);

  const handleSend = async (text: string) => {
    if (!selectedFlow && !sessionId) return;

    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-user`, role: 'user', content: text, timestamp: new Date() },
    ]);
    setSending(true);
    setWaitingForResponse(true);

    try {
      if (!sessionId && selectedFlow) {
        const result = await runFlow.mutateAsync({ flowName: selectedFlow, message: text });
        setSessionId(result.sessionId);
        onSessionCreated(result.sessionId, selectedFlow);
      } else {
        await sendMessage.mutateAsync({ sessionId: sessionId!, message: text });
      }
    } catch (err) {
      setWaitingForResponse(false);
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-err`, role: 'assistant', content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`, timestamp: new Date() },
      ]);
    } finally {
      setSending(false);
    }
  };

  const isActive = !!(selectedFlow || selectedSession);

  return (
    <main className="flex flex-col flex-1 h-full bg-gray-50/50 min-w-0">
      {isActive ? (
        <>
          <ChatHeader
            agentName={agentName}
            flowSessions={flowSessions}
            activeSessionId={activeFlowSessionId}
            onSelectSession={(id, flowName) => {
              setSessionId(id);
              onSelectFlowSession(id);
            }}
          />
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <ChatEmptyState flowName={selectedSession?.flowName ?? selectedFlow ?? undefined} description={flowDescription} />
            ) : (
              <>
                {messages.map((msg) => (
                  <ChatBubble key={msg.id} message={msg} />
                ))}
                {waitingForResponse && (
                  <div className="flex justify-start mb-3">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0 shadow-sm">
                      <span className="text-white text-[10px] font-bold">AI</span>
                    </div>
                    <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-white border border-gray-100 shadow-sm flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </>
            )}
          </div>
          {sessionTempFiles.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-100 bg-white/60 flex flex-wrap gap-1.5">
              {sessionTempFiles.map((file) => (
                <button
                  key={file.name}
                  onClick={() => {
                    if (activeTempFileName === file.name) { setActiveTempFileName(null); setOpenTempFile(null); }
                    else { setActiveTempFileName(file.name); setOpenTempFile(file); }
                  }}
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all duration-150 ${
                    activeTempFileName === file.name
                      ? 'bg-blue-500 border-blue-500 text-white shadow-sm'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
                  }`}
                >
                  {file.name}
                </button>
              ))}
            </div>
          )}
          {openTempFile && (() => {
            const isMarkdown = openTempFile.name.endsWith('.md') || openTempFile.name.endsWith('.mdx');
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { setOpenTempFile(null); setActiveTempFileName(null); setFileDialogRaw(false); }}>
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                    <span className="text-sm font-semibold text-gray-800">{openTempFile.name}</span>
                    <div className="flex items-center gap-1">
                      {isMarkdown && (
                        <button
                          onClick={() => setFileDialogRaw((r) => !r)}
                          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${fileDialogRaw ? 'bg-gray-100 text-gray-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-700'}`}
                        >
                          <FileText size={12} />
                          Raw
                        </button>
                      )}
                      <button onClick={() => copyFile(openTempFile.content)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 text-gray-600 hover:text-gray-700 transition-colors">
                        {fileCopied ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                      <button onClick={() => { setOpenTempFile(null); setActiveTempFileName(null); setFileDialogRaw(false); }} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 text-gray-600 hover:text-gray-700 transition-colors">
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                  {isMarkdown && !fileDialogRaw ? (
                    <div className="flex-1 overflow-auto px-5 py-4">
                      <MarkdownRenderer content={openTempFile.content} />
                    </div>
                  ) : (
                    <pre className="flex-1 overflow-auto px-5 py-4 text-xs text-gray-700 font-mono leading-relaxed whitespace-pre-wrap">{openTempFile.content}</pre>
                  )}
                </div>
              </div>
            );
          })()}
          <ChatInput onSend={handleSend} loading={sending} />
        </>
      ) : (
        <ChatEmptyState />
      )}
    </main>
  );
}
