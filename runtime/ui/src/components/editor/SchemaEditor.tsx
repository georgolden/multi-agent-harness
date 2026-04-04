import { useState, useEffect } from 'react';
import { trpc } from '../../trpcClient.js';
import { Save, X, ChevronDown, ChevronUp, ChevronLeft, Plus, Eye, EyeOff } from 'lucide-react';
import { MarkdownRenderer } from '../chat/MarkdownRenderer.js';

interface SchemaEditorProps {
  flowName: string;
  onClose: () => void;
}

interface AgentLoopConfig {
  onError: 'askUser' | 'retry';
  maxLoopEntering: number;
  loopExit: 'failure' | 'bestAnswer';
  useMemory: boolean;
  useKnowledgeBase: boolean;
}

type PromptView = 'systemPrompt' | 'userPromptTemplate' | null;

function SectionHeader({ title, open, onToggle }: { title: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center justify-between w-full text-left text-xs font-semibold text-gray-500 uppercase tracking-widest py-2 hover:text-gray-700 transition-colors"
    >
      {title}
      {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
  );
}

function TagListEditor({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [inputs, setInputs] = useState<string[]>(['']);

  const removeItem = (idx: number) => {
    onChange(values.filter((_, i) => i !== idx));
  };

  const commitInput = (inputIdx: number) => {
    const val = inputs[inputIdx].trim();
    if (val) {
      onChange([...values, val]);
      setInputs((prev) => prev.filter((_, i) => i !== inputIdx));
    }
  };

  const handleInputKey = (e: React.KeyboardEvent<HTMLInputElement>, inputIdx: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitInput(inputIdx);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-gray-500">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-100 rounded-full px-2.5 py-0.5 font-mono"
          >
            {v}
            {v !== 'submit_result' && (
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="ml-0.5 text-blue-400 hover:text-red-500 transition-colors leading-none"
              >
                <X size={10} />
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        {inputs.map((inp, inputIdx) => (
          <div key={inputIdx} className="flex items-center gap-1.5">
            <input
              type="text"
              value={inp}
              onChange={(e) => setInputs((prev) => prev.map((v, i) => (i === inputIdx ? e.target.value : v)))}
              onKeyDown={(e) => handleInputKey(e, inputIdx)}
              onBlur={() => commitInput(inputIdx)}
              placeholder={placeholder ?? 'Add item…'}
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => setInputs((prev) => [...prev, ''])}
          className="flex items-center gap-1 self-start text-[11px] text-gray-400 hover:text-blue-500 transition-colors mt-0.5"
        >
          <Plus size={12} /> Add another
        </button>
      </div>
    </div>
  );
}

export function SchemaEditor({ flowName, onClose }: SchemaEditorProps) {
  const { data: schema, isLoading } = trpc.getSchema.useQuery({ flowName });
  const updateMutation = trpc.updateSchema.useMutation();

  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPromptTemplate, setUserPromptTemplate] = useState('');
  const [toolNames, setToolNames] = useState<string[]>([]);
  const [skillNames, setSkillNames] = useState<string[]>([]);
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [contextFolders, setContextFolders] = useState<string[]>([]);
  const [agentLoopConfig, setAgentLoopConfig] = useState<AgentLoopConfig>({
    onError: 'retry',
    maxLoopEntering: 10,
    loopExit: 'bestAnswer',
    useMemory: false,
    useKnowledgeBase: false,
  });

  const [sectionsOpen, setSectionsOpen] = useState({
    basic: true,
    prompts: true,
    tools: true,
    context: true,
    loop: true,
  });

  const [promptView, setPromptView] = useState<PromptView>(null);
  const [promptPreview, setPromptPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!schema) return;
    setDescription(schema.description ?? '');
    setSystemPrompt(schema.systemPrompt ?? '');
    setUserPromptTemplate(schema.userPromptTemplate ?? '');
    setToolNames(schema.toolNames ?? []);
    setSkillNames(schema.skillNames ?? []);
    setContextFiles(schema.contextPaths?.files ?? []);
    setContextFolders(schema.contextPaths?.folders ?? []);
    if (schema.agentLoopConfig) setAgentLoopConfig(schema.agentLoopConfig as AgentLoopConfig);
  }, [schema]);

  const toggleSection = (key: keyof typeof sectionsOpen) =>
    setSectionsOpen((s) => ({ ...s, [key]: !s[key] }));

  const handleSave = async () => {
    setError(null);
    try {
      await updateMutation.mutateAsync({
        flowName,
        schema: {
          description,
          systemPrompt,
          userPromptTemplate: userPromptTemplate || undefined,
          toolNames,
          skillNames,
          contextPaths: { files: contextFiles, folders: contextFolders },
          agentLoopConfig,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        Loading schema…
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        Schema not found.
      </div>
    );
  }

  const promptLabel = promptView === 'systemPrompt' ? 'System Prompt' : 'User Prompt Template';
  const promptValue = promptView === 'systemPrompt' ? systemPrompt : userPromptTemplate;
  const promptOnChange = promptView === 'systemPrompt' ? setSystemPrompt : setUserPromptTemplate;

  // ── Prompt edit view ──────────────────────────────────────────────────────
  if (promptView) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-white">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setPromptView(null); setPromptPreview(false); }}
              className="flex items-center gap-1.5 text-gray-400 hover:text-gray-700 transition-colors group"
            >
              <ChevronLeft size={15} />
              <span className="text-xs">{flowName}</span>
            </button>
            <span className="text-xs text-gray-300">/</span>
            <span className="text-sm font-semibold text-gray-900">{promptLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPromptPreview((p) => !p)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-1 rounded hover:bg-gray-100"
            >
              {promptPreview ? <EyeOff size={13} /> : <Eye size={13} />}
              {promptPreview ? 'Raw' : 'Preview'}
            </button>
            {error && <span className="text-xs text-red-500">{error}</span>}
            {saved && <span className="text-xs text-green-600">Saved</span>}
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              <Save size={14} />
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {promptPreview ? (
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <MarkdownRenderer content={promptValue || '_empty_'} />
            </div>
          ) : (
            <textarea
              value={promptValue}
              onChange={(e) => promptOnChange(e.target.value)}
              className="flex-1 w-full text-sm px-6 py-4 font-mono resize-none focus:outline-none border-none"
              autoFocus
            />
          )}
        </div>
      </div>
    );
  }

  // ── Main editor view ──────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Edit Schema Agent</h2>
          <p className="text-xs text-gray-400 mt-0.5">{flowName}</p>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-red-500">{error}</span>}
          {saved && <span className="text-xs text-green-600">Saved</span>}
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            <Save size={14} />
            {updateMutation.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-0">
        {/* Basic */}
        <SectionHeader title="Basic" open={sectionsOpen.basic} onToggle={() => toggleSection('basic')} />
        {sectionsOpen.basic && (
          <div className="flex flex-col gap-3 pb-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Flow Name</label>
              <input
                value={flowName}
                disabled
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-400 cursor-not-allowed"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Description</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
        )}
        <div className="h-px bg-gray-100" />

        {/* Prompts */}
        <SectionHeader title="Prompts" open={sectionsOpen.prompts} onToggle={() => toggleSection('prompts')} />
        {sectionsOpen.prompts && (
          <div className="flex flex-col gap-2 pb-4">
            <button
              type="button"
              onClick={() => setPromptView('systemPrompt')}
              className="flex items-center justify-between w-full text-left px-3 py-2.5 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/40 transition-colors group"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs text-gray-500 group-hover:text-blue-600">System Prompt</span>
                <span className="text-sm text-gray-400 font-mono truncate">
                  {systemPrompt ? systemPrompt.split('\n')[0].slice(0, 60) || '…' : <em className="not-italic text-gray-300">empty</em>}
                </span>
              </div>
              <ChevronDown size={14} className="text-gray-300 flex-shrink-0 -rotate-90" />
            </button>
            <button
              type="button"
              onClick={() => setPromptView('userPromptTemplate')}
              className="flex items-center justify-between w-full text-left px-3 py-2.5 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/40 transition-colors group"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs text-gray-500 group-hover:text-blue-600">User Prompt Template <span className="text-gray-300">(optional)</span></span>
                <span className="text-sm text-gray-400 font-mono truncate">
                  {userPromptTemplate ? userPromptTemplate.split('\n')[0].slice(0, 60) || '…' : <em className="not-italic text-gray-300">empty</em>}
                </span>
              </div>
              <ChevronDown size={14} className="text-gray-300 flex-shrink-0 -rotate-90" />
            </button>
          </div>
        )}
        <div className="h-px bg-gray-100" />

        {/* Tools & Skills */}
        <SectionHeader title="Tools & Skills" open={sectionsOpen.tools} onToggle={() => toggleSection('tools')} />
        {sectionsOpen.tools && (
          <div className="flex flex-col gap-4 pb-4">
            <TagListEditor label="Tool Names" values={toolNames} onChange={setToolNames} placeholder="tool name…" />
            <TagListEditor label="Skill Names" values={skillNames} onChange={setSkillNames} placeholder="skill name…" />
          </div>
        )}
        <div className="h-px bg-gray-100" />

        {/* Context Paths */}
        <SectionHeader title="Context Paths" open={sectionsOpen.context} onToggle={() => toggleSection('context')} />
        {sectionsOpen.context && (
          <div className="flex flex-col gap-4 pb-4">
            <TagListEditor label="Files" values={contextFiles} onChange={setContextFiles} placeholder="/path/to/file…" />
            <TagListEditor label="Folders" values={contextFolders} onChange={setContextFolders} placeholder="/path/to/folder…" />
          </div>
        )}
        <div className="h-px bg-gray-100" />

        {/* Agent Loop Config */}
        <SectionHeader title="Agent Loop Config" open={sectionsOpen.loop} onToggle={() => toggleSection('loop')} />
        {sectionsOpen.loop && (
          <div className="flex flex-col gap-2 pb-4">
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500 w-36 flex-shrink-0">On Error</label>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
                {(['retry', 'askUser'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setAgentLoopConfig((c) => ({ ...c, onError: opt }))}
                    className={`px-3 py-1.5 font-mono transition-colors ${agentLoopConfig.onError === opt ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500 w-36 flex-shrink-0">Loop Exit</label>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
                {(['bestAnswer', 'failure'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setAgentLoopConfig((c) => ({ ...c, loopExit: opt }))}
                    className={`px-3 py-1.5 font-mono transition-colors ${agentLoopConfig.loopExit === opt ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500 w-36 flex-shrink-0">Max Loop Iterations</label>
              <input
                type="number"
                min={1}
                value={agentLoopConfig.maxLoopEntering}
                onChange={(e) => setAgentLoopConfig((c) => ({ ...c, maxLoopEntering: Number(e.target.value) }))}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-24 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500 w-36 flex-shrink-0">Use Memory</label>
              <input
                type="checkbox"
                checked={agentLoopConfig.useMemory}
                onChange={(e) => setAgentLoopConfig((c) => ({ ...c, useMemory: e.target.checked }))}
                className="rounded"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500 w-36 flex-shrink-0">Use Knowledge Base</label>
              <input
                type="checkbox"
                checked={agentLoopConfig.useKnowledgeBase}
                onChange={(e) => setAgentLoopConfig((c) => ({ ...c, useKnowledgeBase: e.target.checked }))}
                className="rounded"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
