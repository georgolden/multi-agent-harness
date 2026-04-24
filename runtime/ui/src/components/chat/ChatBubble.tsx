import { useState } from 'react';
import { X, ChevronRight, Wrench, Copy, Check, FileText, CheckCircle2 } from 'lucide-react';
import type { ChatMessage, TempFile, ToolCallInfo } from '../../types.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return { copied, copy };
}

function CopyBtn({ text, light = false }: { text: string; light?: boolean }) {
  const { copied, copy } = useCopy();
  return (
    <button
      onClick={() => copy(text)}
      title="Copy"
      className={`w-6 h-6 flex items-center justify-center rounded-md transition-colors flex-shrink-0 ${
        light
          ? 'text-white/60 hover:text-white hover:bg-white/10'
          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
      }`}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

interface ChatBubbleProps {
  message: ChatMessage;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function FileDialog({ file, onClose }: { file: TempFile; onClose: () => void }) {
  const isMarkdown = file.name.endsWith('.md') || file.name.endsWith('.mdx');
  const [raw, setRaw] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-800">{file.name}</span>
          <div className="flex items-center gap-1">
            {isMarkdown && (
              <button
                onClick={() => setRaw((r) => !r)}
                title={raw ? 'Rendered' : 'Raw'}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  raw ? 'bg-gray-100 text-gray-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-700'
                }`}
              >
                <FileText size={12} />
                Raw
              </button>
            )}
            <CopyBtn text={file.content} />
            <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 text-gray-600 hover:text-gray-700 transition-colors">
              <X size={15} />
            </button>
          </div>
        </div>
        {isMarkdown && !raw ? (
          <div className="flex-1 overflow-auto px-5 py-4">
            <MarkdownRenderer content={file.content} />
          </div>
        ) : (
          <pre className="flex-1 overflow-auto px-5 py-4 text-xs text-gray-700 font-mono leading-relaxed whitespace-pre-wrap">{file.content}</pre>
        )}
      </div>
    </div>
  );
}

function ToolDialog({ tool, onClose }: { tool: ToolCallInfo; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Wrench size={14} className="text-violet-500" />
            <span className="text-sm font-semibold text-gray-800">{tool.name}</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 text-gray-600 hover:text-gray-700 transition-colors">
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-auto divide-y divide-gray-100">
          <div className="px-5 py-4">
            <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-2">Arguments</p>
            <pre className="text-xs text-gray-700 font-mono leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl p-3">
              {JSON.stringify(tool.args, null, 2)}
            </pre>
          </div>
          {tool.result !== undefined && (
            <div className="px-5 py-4">
              <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-2">Result</p>
              <pre className="text-xs text-gray-700 font-mono leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl p-3">
                {tool.result}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolCallBubble({ message }: { message: ChatMessage }) {
  const [openTool, setOpenTool] = useState<ToolCallInfo | null>(null);
  const tools = message.toolCalls ?? [];

  return (
    <>
      <div className="flex justify-start mb-3">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0 shadow-sm">
          <Wrench size={11} className="text-white" />
        </div>
        <div className="flex flex-col gap-1 max-w-[72%]">
          <div className="flex flex-col gap-1">
            {tools.map((tc) => (
              <div
                key={tc.id}
                className="flex items-center gap-2 px-3 py-2 bg-violet-50 border border-violet-100 rounded-xl"
              >
                <Wrench size={12} className="text-violet-400 flex-shrink-0" />
                <span className="text-xs font-medium text-violet-700 flex-1 truncate">Tool: {tc.name}</span>
                <button
                  onClick={() => setOpenTool(tc)}
                  className="w-6 h-6 flex items-center justify-center rounded-lg bg-violet-100 hover:bg-violet-200 text-violet-500 hover:text-violet-700 transition-colors flex-shrink-0"
                  title="View details"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            ))}
          </div>
          <span className="text-[10px] text-gray-500 px-1">{formatTime(message.timestamp)}</span>
        </div>
      </div>
      {openTool && <ToolDialog tool={openTool} onClose={() => setOpenTool(null)} />}
    </>
  );
}

function tryParseJson(s: string): Record<string, unknown> | null {
  const trimmed = s.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try { const v = JSON.parse(trimmed); return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null; }
  catch { return null; }
}

function JsonValue({ value, depth }: { value: unknown; depth: number }) {
  if (value === null || value === undefined) return <span className="text-gray-400 italic text-xs">empty</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-gray-400 italic text-xs">empty</span>;
    return (
      <ul className="list-disc list-inside space-y-1 pl-1">
        {value.map((v, i) =>
          typeof v === 'object' && v !== null
            ? <li key={i} className="text-xs text-gray-700"><JsonFields obj={v as Record<string, unknown>} depth={depth + 1} /></li>
            : <li key={i} className="text-xs text-gray-700">{String(v)}</li>
        )}
      </ul>
    );
  }

  if (typeof value === 'object') {
    return <JsonFields obj={value as Record<string, unknown>} depth={depth + 1} />;
  }

  if (typeof value === 'string') {
    const nested = tryParseJson(value);
    if (nested) return <JsonFields obj={nested} depth={depth + 1} />;
    return <MarkdownRenderer content={value} />;
  }

  return <span className="text-xs text-gray-700">{String(value)}</span>;
}

function JsonFields({ obj, depth }: { obj: Record<string, unknown>; depth: number }) {
  const headingClass = depth === 0
    ? 'text-sm font-bold text-gray-800 border-b border-gray-100 pb-1 mb-2 mt-4 first:mt-0'
    : depth === 1
      ? 'text-xs font-semibold text-gray-700 mt-3 mb-1'
      : 'text-xs font-medium text-gray-600 mt-2 mb-0.5';

  return (
    <div>
      {Object.entries(obj).map(([key, value]) => (
        <div key={key}>
          <div className={headingClass}>{key}</div>
          <div className={depth === 0 ? 'mb-2' : ''}>
            <JsonValue value={value} depth={depth} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultBubble({ message }: { message: ChatMessage }) {
  const [raw, setRaw] = useState(false);
  const data = message.resultData ?? {};
  const jsonStr = JSON.stringify(data, null, 2);

  return (
    <div className="flex justify-start mb-3">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0 shadow-sm">
        <CheckCircle2 size={13} className="text-white" />
      </div>
      <div className="flex flex-col gap-1 max-w-[72%]">
        <div className="bg-white border border-emerald-100 rounded-2xl rounded-bl-md shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-emerald-50 bg-emerald-50/60">
            <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-widest">Result</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setRaw((r) => !r)}
                title={raw ? 'Rendered' : 'Raw'}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                  raw ? 'bg-emerald-100 text-emerald-700' : 'text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700'
                }`}
              >
                <FileText size={11} />
                Raw
              </button>
              <CopyBtn text={jsonStr} />
            </div>
          </div>
          <div className="px-4 py-3">
            {raw
              ? <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap text-gray-700">{jsonStr}</pre>
              : <JsonFields obj={data} depth={0} />
            }
          </div>
        </div>
        <span className="text-[10px] text-gray-500 px-1">{formatTime(message.timestamp)}</span>
      </div>
    </div>
  );
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const [selectedFile, setSelectedFile] = useState<TempFile | null>(null);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);

  if (message.role === 'tool_call') return <ToolCallBubble message={message} />;
  if (message.role === 'tool_result') return null;
  if (message.role === 'result') return <ResultBubble message={message} />;

  const isUser = message.role === 'user';

  return (
    <>
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
        {!isUser && (
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0 shadow-sm">
            <span className="text-white text-[10px] font-bold">AI</span>
          </div>
        )}
        <div className={`max-w-[72%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
          {message.tempFiles && message.tempFiles.length > 0 && (
            <div className={`flex flex-wrap gap-1.5 mb-0.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
              {message.tempFiles.map((file) => (
                <button
                  key={file.name}
                  onClick={() => {
                    if (activeFileName === file.name) { setActiveFileName(null); setSelectedFile(null); }
                    else { setActiveFileName(file.name); setSelectedFile(file); }
                  }}
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all duration-150 ${
                    activeFileName === file.name
                      ? 'bg-blue-500 border-blue-500 text-white shadow-sm'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
                  }`}
                >
                  {file.name}
                </button>
              ))}
            </div>
          )}
          <div
            className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
              isUser
                ? 'bg-blue-500 text-white rounded-br-md shadow-sm whitespace-pre-wrap'
                : 'bg-white text-gray-800 rounded-bl-md shadow-sm border border-gray-100'
            }`}
          >
            {!isUser && (
              <div className="flex items-center justify-end gap-1 mb-1.5">
                <button
                  onClick={() => setRaw((r) => !r)}
                  title={raw ? 'Rendered' : 'Raw'}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                    raw ? 'bg-gray-100 text-gray-700' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                  }`}
                >
                  <FileText size={11} />
                  Raw
                </button>
                <CopyBtn text={message.content} />
              </div>
            )}
            {isUser
              ? message.content
              : raw
                ? <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap text-gray-700">{message.content}</pre>
                : <MarkdownRenderer content={message.content} />
            }
          </div>
          <span className="text-[10px] text-gray-500 px-1">{formatTime(message.timestamp)}</span>
        </div>
      </div>
      {selectedFile && (
        <FileDialog file={selectedFile} onClose={() => { setSelectedFile(null); setActiveFileName(null); }} />
      )}
    </>
  );
}
