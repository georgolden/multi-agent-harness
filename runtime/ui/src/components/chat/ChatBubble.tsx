import { useState } from 'react';
import { X, ChevronRight, Wrench } from 'lucide-react';
import type { ChatMessage, TempFile, ToolCallInfo } from '../../types.js';

interface ChatBubbleProps {
  message: ChatMessage;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function FileDialog({ file, onClose }: { file: TempFile; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-800">{file.name}</span>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={15} />
          </button>
        </div>
        <pre className="flex-1 overflow-auto px-5 py-4 text-xs text-gray-700 font-mono leading-relaxed whitespace-pre-wrap">{file.content}</pre>
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
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-auto divide-y divide-gray-100">
          <div className="px-5 py-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Arguments</p>
            <pre className="text-xs text-gray-700 font-mono leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl p-3">
              {JSON.stringify(tool.args, null, 2)}
            </pre>
          </div>
          {tool.result !== undefined && (
            <div className="px-5 py-4">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Result</p>
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
          <span className="text-[10px] text-gray-300 px-1">{formatTime(message.timestamp)}</span>
        </div>
      </div>
      {openTool && <ToolDialog tool={openTool} onClose={() => setOpenTool(null)} />}
    </>
  );
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const [selectedFile, setSelectedFile] = useState<TempFile | null>(null);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);

  if (message.role === 'tool_call') return <ToolCallBubble message={message} />;
  // tool_result messages are merged into their parent tool_call; skip standalone ones
  if (message.role === 'tool_result') return null;

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
          {isUser && message.tempFiles && message.tempFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-end mb-0.5">
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
      {selectedFile && (
        <FileDialog file={selectedFile} onClose={() => { setSelectedFile(null); setActiveFileName(null); }} />
      )}
    </>
  );
}
