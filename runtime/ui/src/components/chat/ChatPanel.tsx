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
  agentSessionStatus?: string | null;
  isSchemaAgent?: boolean;
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

function parseMessages(rawMessages: RawMessage[], tempFiles: TempFile[], sessionPrefix = ''): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  const toolCallMsgByCallId = new Map<string, ChatMessage>();
  // Track which temp file names have been written so far (by name, latest content from tempFiles)
  const writtenFileNames = new Set<string>();
  const tempFilesByName = new Map(tempFiles.map((f) => [f.name, f]));

  const snapshotTempFiles = (): TempFile[] | undefined => {
    if (writtenFileNames.size === 0) return undefined;
    const files = [...writtenFileNames].map((n) => tempFilesByName.get(n)).filter((f): f is TempFile => !!f);
    return files.length > 0 ? files : undefined;
  };

  for (let i = 0; i < rawMessages.length; i++) {
    const m = rawMessages[i];
    const { role, content, tool_calls, tool_call_id } = m.message;
    const ts = new Date(m.timestamp);
    const id = `${sessionPrefix}msg-${i}`;

    if (role === 'system') continue;

    if (role === 'user') {
      const { text, tempFiles: tf } = parseUserMessage(extractText(content));
      if (!text) continue;
      const attachFiles = msgs.length === 0 && tempFiles.length > 0 ? tempFiles : tf;
      msgs.push({ id, role: 'user', content: text, tempFiles: attachFiles.length > 0 ? attachFiles : undefined, timestamp: ts });
      continue;
    }

    if (role === 'assistant') {
      if (tool_calls && Array.isArray(tool_calls) && tool_calls.length > 0) {
        const rawCalls = tool_calls as Array<{ id: string; function: { name: string; arguments: string } }>;
        const submitCall = rawCalls.find((tc) => tc.function.name === 'submit_result');
        if (submitCall) {
          const resultData = (() => { try { return JSON.parse(submitCall.function.arguments) as Record<string, unknown>; } catch { return {}; } })();
          msgs.push({ id, role: 'result', content: '', resultData, timestamp: ts });
          continue;
        }
        // Track write_temp_file calls so we can attach them to the next text message
        for (const tc of rawCalls) {
          if (tc.function.name === 'write_temp_file') {
            try {
              const args = JSON.parse(tc.function.arguments) as { name?: string };
              if (args.name) writtenFileNames.add(args.name);
            } catch { /* ignore */ }
          }
        }
        const calls: ToolCallInfo[] = rawCalls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          args: (() => { try { return JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { return {}; } })(),
        }));
        const msg: ChatMessage = { id, role: 'tool_call', content: extractText(content), toolCalls: calls, timestamp: ts };
        msgs.push(msg);
        for (const tc of calls) toolCallMsgByCallId.set(tc.id, msg);
        continue;
      }
      const text = extractText(content);
      console.log(`[parseMessages] assistant text msg id=${id} textLen=${text.length} text=${text.slice(0, 60)}`);
      if (text) msgs.push({ id, role: 'assistant', content: text, tempFiles: snapshotTempFiles(), timestamp: ts });
      continue;
    }

    if (role === 'tool' && tool_call_id) {
      const resultText = extractText(content);
      const parent = toolCallMsgByCallId.get(tool_call_id as string);
      if (parent?.toolCalls) {
        const tc = parent.toolCalls.find((c) => c.id === tool_call_id);
        if (tc) { tc.result = resultText; continue; }
      }
      msgs.push({ id, role: 'tool_result', content: resultText, toolCallId: tool_call_id as string, timestamp: ts });
    }
  }

  return msgs;
}

// Returns true if the last user message has no assistant or result message after it.
function isAwaitingResponse(messages: ChatMessage[]): boolean {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIdx = i; break; }
  }
  if (lastUserIdx === -1) return false;
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    if (messages[i].role === 'assistant' || messages[i].role === 'result') return false;
  }
  return true;
}

export function ChatPanel({ selectedFlow, selectedSession, onSessionCreated, onSelectFlowSession, flowDescription, agentName, flowSessions, agentSessionStatus, isSchemaAgent }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [sending, setSending] = useState(false);
  const [localAgentStatus, setLocalAgentStatus] = useState<string | null>(agentSessionStatus ?? null);
  const [sessionTempFiles, setSessionTempFiles] = useState<TempFile[]>([]);
  const [openTempFile, setOpenTempFile] = useState<TempFile | null>(null);
  const [activeTempFileName, setActiveTempFileName] = useState<string | null>(null);
  const [fileDialogRaw, setFileDialogRaw] = useState(false);
  const [fileCopied, setFileCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Compute the effective session ID for rendering/queries.
  // NOTE: sessionIdRef.current is set synchronously in handleSend (before state updates),
  // and also kept in sync here — but only when activeFlowSessionId is non-null, so we
  // never overwrite the ref with null between the mutateAsync resolve and the next re-render.
  const activeFlowSessionId = selectedSession?.id ?? sessionId;
  if (activeFlowSessionId && sessionIdRef.current !== activeFlowSessionId) {
    sessionIdRef.current = activeFlowSessionId;
  }

  const copyFile = (content: string) => {
    void navigator.clipboard.writeText(content).then(() => {
      setFileCopied(true);
      setTimeout(() => setFileCopied(false), 1500);
    });
  };

  const runAgent = trpc.runAgent.useMutation();
  const sendMessage = trpc.sendMessage.useMutation();
  const continueAgent = trpc.continueAgent.useMutation();
  const continueSchemaAgent = trpc.continueSchemaAgent.useMutation();
  const utils = trpc.useUtils();

  const { data: sessionData, refetch: refetchSession } = trpc.getSession.useQuery(
    { sessionId: activeFlowSessionId ?? '' },
    { enabled: !!activeFlowSessionId },
  );

  // Identify flow sessions that ran before the active one (continued sessions = same agent thread)
  const activeIdx = flowSessions.findIndex((fs) => fs.id === activeFlowSessionId);
  const previousSessionIds = activeIdx > 0 ? flowSessions.slice(0, activeIdx).map((fs) => fs.id) : [];

  // Fetch each previous session's data so we can show their messages as history
  const previousSessionQueries = trpc.useQueries((t) =>
    previousSessionIds.map((id) => t.getSession({ sessionId: id })),
  );
  const prevQueriesReady = previousSessionIds.length === 0 || previousSessionQueries.every((q) => !!q.data);

  useEffect(() => {
    if (!sessionData || !prevQueriesReady) return;
    const data = sessionData as { messages?: RawMessage[]; tempFiles?: TempFile[]; status?: string };
    const tempFiles = data.tempFiles ?? [];

    // Build history from previous sessions (oldest first), then current session messages
    const historyMessages: ChatMessage[] = [];
    for (let qi = 0; qi < previousSessionQueries.length; qi++) {
      const q = previousSessionQueries[qi];
      if (!q.data) continue;
      const prev = q.data as { messages?: RawMessage[]; tempFiles?: TempFile[] };
      historyMessages.push(...parseMessages(prev.messages ?? [], prev.tempFiles ?? [], `${previousSessionIds[qi]}-`));
    }

    const rawMsgs = data.messages ?? [];
    console.log(`[ChatPanel.useEffect] raw messages count=${rawMsgs.length} last3=${JSON.stringify(rawMsgs.slice(-3).map((m: RawMessage) => ({ role: m.message.role, contentLen: String(m.message.content ?? '').length })))}`);
    const current = parseMessages(rawMsgs, tempFiles, `${activeFlowSessionId}-`);
    console.log(`[ChatPanel.useEffect] setMessages count=${current.length} sessionId=${activeFlowSessionId}`);
    setMessages([...historyMessages, ...current]);
    setSessionTempFiles(tempFiles);
    setSessionId(activeFlowSessionId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionData, activeFlowSessionId, prevQueriesReady]);

  // Subscribe to ALL user events (no sessionId filter) so that when continueAgent creates a new
  // flow session, events for that new session are received without needing to reconnect.
  // We filter client-side: session:message:update only refetches the relevant session.
  trpc.streamEvents.useSubscription(
    {},
    {
      onData(event) {
        console.log(`[ChatPanel.onData] type=${event.type} activeFlowSessionId=${activeFlowSessionId}`);
        if (event.type === 'session:message:update') {
          const sid = (event as { sessionId?: string }).sessionId ?? '';
          const trackedIds = new Set([activeFlowSessionId, ...flowSessions.map((fs) => fs.id)].filter(Boolean));
          console.log(`[ChatPanel.onData] session:message:update sid=${sid} tracked=${[...trackedIds].join(',')}`);
          if (sid && trackedIds.has(sid)) {
            console.log(`[ChatPanel.onData] invalidating getSession sid=${sid}`);
            void utils.getSession.invalidate({ sessionId: sid });
          }
        }
        if (event.type === 'session:statusChange') {
          const e = event as { type: string; to: string; sessionId?: string };
          const sid = e.sessionId ?? '';
          console.log(`[ChatPanel.onData] session:statusChange sid=${sid} to=${e.to} activeFlowSessionId=${activeFlowSessionId}`);
          if (sid) void utils.getSession.invalidate({ sessionId: sid });
          if (sid === activeFlowSessionId) {
            console.log(`[ChatPanel.onData] refetchSession for activeFlowSessionId=${activeFlowSessionId}`);
            void refetchSession();
            // On terminal states, the submit_result message commit may race with the
            // status change. Refetch once more shortly after to guarantee the result lands.
            if (e.to === 'completed' || e.to === 'failed') {
              setTimeout(() => { void refetchSession(); }, 250);
            }
          }
          setLocalAgentStatus(e.to);
        }
        if (event.type === 'session:message') {
          const e = event as { type: string; sessionId?: string; message?: string };
          const sid = e.sessionId ?? '';
          const trackedIds = new Set([activeFlowSessionId, ...flowSessions.map((fs) => fs.id)].filter(Boolean));
          console.log(`[ChatPanel.onData] session:message sid=${sid} message=${String(e.message).slice(0, 80)}`);
          // Optimistic append — ensures the assistant message appears immediately
          // even if the subsequent refetch is delayed. Dedup against the last message
          // so we don't double-render once the refetch lands.
          if (e.message && sid === activeFlowSessionId) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant' && last.content === e.message) return prev;
              return [...prev, { id: `live-${Date.now()}`, role: 'assistant', content: e.message!, timestamp: new Date() }];
            });
          }
          // Also invalidate so the canonical server state lands and reconciles.
          if (sid && trackedIds.has(sid)) {
            void utils.getSession.invalidate({ sessionId: sid });
          }
        }
      },
    },
  );

  useEffect(() => {
    setLocalAgentStatus(agentSessionStatus ?? null);
  }, [agentSessionStatus]);

  useEffect(() => {
    if (selectedSession) return;
    setMessages([]);
    setSessionId(null);
    sessionIdRef.current = null;
    setSessionTempFiles([]);
    setLocalAgentStatus(null);
  }, [selectedFlow, selectedSession]);

  const waitingForResponse = isAwaitingResponse(messages);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text: string) => {
    if (!selectedFlow && !sessionId) return;

    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-user`, role: 'user', content: text, timestamp: new Date() },
    ]);
    setSending(true);

    try {
      if (!sessionId && selectedFlow) {
        const result = await runAgent.mutateAsync({ agentName: selectedFlow, message: text });
        // Set ref synchronously so subscription input changes on this render cycle,
        // before the batched state update from setSessionId takes effect.
        sessionIdRef.current = result.sessionId;
        setSessionId(result.sessionId);
        onSessionCreated(result.sessionId, selectedFlow);
        // Immediately fetch session data — events may have already fired before subscription started
        void utils.getSession.invalidate({ sessionId: result.sessionId });
      } else if (agentName && (localAgentStatus === 'completed' || localAgentStatus === 'failed')) {
        console.log('[ChatPanel.handleSend] continuing agent', { agentName, isSchemaAgent, localAgentStatus });
        if (isSchemaAgent && agentName === 'Agentic Loop') {
          throw new Error(`[ChatPanel] isSchemaAgent=true but agentName is "Agentic Loop" — schemaFlowName was not resolved, cannot continue`);
        }
        const result = isSchemaAgent
          ? await continueSchemaAgent.mutateAsync({ flowName: agentName, message: text })
          : await continueAgent.mutateAsync({ agentName, message: text });
        if (result.sessionId) {
          sessionIdRef.current = result.sessionId;
          setSessionId(result.sessionId);
          onSessionCreated(result.sessionId, agentName);
          void utils.getSession.invalidate({ sessionId: result.sessionId });
        }
      } else {
        await sendMessage.mutateAsync({ sessionId: sessionId!, message: text });
        // Immediately refetch after sending — agent may already have responded
        void utils.getSession.invalidate({ sessionId: sessionId! });
      }
    } catch (err) {
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
