import { useState, useEffect } from 'react';
import { trpc } from '../../trpcClient.js';
import { Save, X, ChevronDown, ChevronUp } from 'lucide-react';

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

function StringListEditor({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const text = values.join('\n');
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500">{label}</label>
      <textarea
        rows={3}
        value={text}
        onChange={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
        placeholder="One item per line"
      />
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
    tools: false,
    context: false,
    loop: false,
  });

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

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white">
      {/* Header */}
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

      {/* Body */}
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
          <div className="flex flex-col gap-3 pb-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">System Prompt</label>
              <textarea
                rows={8}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">User Prompt Template <span className="text-gray-300">(optional)</span></label>
              <textarea
                rows={3}
                value={userPromptTemplate}
                onChange={(e) => setUserPromptTemplate(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
        )}
        <div className="h-px bg-gray-100" />

        {/* Tools & Skills */}
        <SectionHeader title="Tools & Skills" open={sectionsOpen.tools} onToggle={() => toggleSection('tools')} />
        {sectionsOpen.tools && (
          <div className="flex flex-col gap-3 pb-4">
            <StringListEditor label="Tool Names" values={toolNames} onChange={setToolNames} />
            <StringListEditor label="Skill Names" values={skillNames} onChange={setSkillNames} />
          </div>
        )}
        <div className="h-px bg-gray-100" />

        {/* Context Paths */}
        <SectionHeader title="Context Paths" open={sectionsOpen.context} onToggle={() => toggleSection('context')} />
        {sectionsOpen.context && (
          <div className="flex flex-col gap-3 pb-4">
            <StringListEditor label="Files" values={contextFiles} onChange={setContextFiles} />
            <StringListEditor label="Folders" values={contextFolders} onChange={setContextFolders} />
          </div>
        )}
        <div className="h-px bg-gray-100" />

        {/* Agent Loop Config */}
        <SectionHeader title="Agent Loop Config" open={sectionsOpen.loop} onToggle={() => toggleSection('loop')} />
        {sectionsOpen.loop && (
          <div className="flex flex-col gap-3 pb-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">On Error</label>
                <select
                  value={agentLoopConfig.onError}
                  onChange={(e) => setAgentLoopConfig((c) => ({ ...c, onError: e.target.value as 'askUser' | 'retry' }))}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="retry">retry</option>
                  <option value="askUser">askUser</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Loop Exit</label>
                <select
                  value={agentLoopConfig.loopExit}
                  onChange={(e) => setAgentLoopConfig((c) => ({ ...c, loopExit: e.target.value as 'failure' | 'bestAnswer' }))}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="bestAnswer">bestAnswer</option>
                  <option value="failure">failure</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Max Loop Iterations</label>
                <input
                  type="number"
                  min={1}
                  value={agentLoopConfig.maxLoopEntering}
                  onChange={(e) => setAgentLoopConfig((c) => ({ ...c, maxLoopEntering: Number(e.target.value) }))}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agentLoopConfig.useMemory}
                  onChange={(e) => setAgentLoopConfig((c) => ({ ...c, useMemory: e.target.checked }))}
                  className="rounded"
                />
                Use Memory
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agentLoopConfig.useKnowledgeBase}
                  onChange={(e) => setAgentLoopConfig((c) => ({ ...c, useKnowledgeBase: e.target.checked }))}
                  className="rounded"
                />
                Use Knowledge Base
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
