import { X, Plug, Loader2, Search, ChevronDown, ChevronUp, ExternalLink, CheckCircle, AlertCircle, Trash2 } from 'lucide-react';
import { trpc } from '../../trpcClient.js';
import { useState, useMemo, useRef, memo, useCallback } from 'react';

interface ToolkitsViewProps {
  onClose: () => void;
}

interface ToolkitItem {
  slug: string;
  name: string;
  description: string;
  logo: string;
  categories: string[];
  authSchemes: string[];
  noAuth: boolean;
}

interface ConnectedToolkit {
  id: string;
  toolkitSlug: string;
  name: string;
  logo: string;
  provider: string;
}

const POPULAR_SLUGS = ['github', 'gmail', 'googlecalendar', 'slack', 'notion', 'linear', 'jira', 'googledrive', 'discord', 'twitter'];

// ─── Icon with persistent cache ───────────────────────────────────────────────

const logoCache = new Map<string, 'ok' | 'error'>();

const ToolkitLogo = memo(function ToolkitLogo({ src, name, size = 40 }: { src: string; name: string; size?: number }) {
  const cached = src ? logoCache.get(src) : 'error';

  if (!src || cached === 'error') {
    return (
      <div
        className="rounded-xl bg-gray-100 flex items-center justify-center text-gray-400 flex-none"
        style={{ width: size, height: size }}
      >
        <Plug size={size * 0.45} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className="rounded-xl object-contain flex-none"
      style={{ width: size, height: size }}
      onLoad={() => { logoCache.set(src, 'ok'); }}
      onError={(e) => {
        logoCache.set(src, 'error');
        (e.currentTarget as HTMLImageElement).style.display = 'none';
      }}
    />
  );
});

// ─── Connect modal ────────────────────────────────────────────────────────────

type ConnectPhase = 'idle' | 'initiating' | 'waiting' | 'success' | 'error';

interface ConnectModalProps {
  toolkit: ToolkitItem;
  onClose: () => void;
  onConnected: () => void;
}

function ConnectModal({ toolkit, onClose, onConnected }: ConnectModalProps) {
  const [phase, setPhase] = useState<ConnectPhase>('idle');
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const externalUserIdRef = useRef<string | null>(null);

  const initiate = trpc.initiateToolkitConnection.useMutation();
  const complete = trpc.completeToolkitConnection.useMutation();

  const handleConnect = useCallback(async () => {
    setPhase('initiating');
    setErrorMsg(null);
    try {
      const result = await initiate.mutateAsync({ provider: 'composio', toolkitSlug: toolkit.slug });
      externalUserIdRef.current = result.externalUserId;
      setRedirectUrl(result.redirectUrl);
      window.open(result.redirectUrl, '_blank', 'noopener,noreferrer');
      setPhase('waiting');
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Failed to start authorization');
      setPhase('error');
    }
  }, [initiate, toolkit.slug]);

  const handleDone = useCallback(async () => {
    if (!externalUserIdRef.current) return;
    setPhase('waiting');
    setErrorMsg(null);
    try {
      await complete.mutateAsync({
        provider: 'composio',
        toolkitSlug: toolkit.slug,
        externalUserId: externalUserIdRef.current,
      });
      setPhase('success');
      setTimeout(() => {
        onConnected();
        onClose();
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Authorization did not complete. Please try again.');
      setPhase('error');
    }
  }, [complete, toolkit.slug, onConnected, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6 flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <ToolkitLogo src={toolkit.logo} name={toolkit.name} size={44} />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Connect {toolkit.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{toolkit.description}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-none">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {phase === 'idle' && (
          <>
            <p className="text-sm text-gray-600">
              You'll be redirected to authorize access. After completing authorization, come back here and click <strong>Done</strong>.
            </p>
            <button
              onClick={handleConnect}
              className="flex items-center justify-center gap-2 h-10 px-5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors"
            >
              <ExternalLink size={15} />
              Authorize {toolkit.name}
            </button>
          </>
        )}

        {phase === 'initiating' && (
          <div className="flex items-center justify-center gap-3 py-4 text-gray-500">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Starting authorization…</span>
          </div>
        )}

        {phase === 'waiting' && (
          <>
            <p className="text-sm text-gray-600">
              Complete authorization in the browser window that opened. If it didn't open,{' '}
              <a href={redirectUrl ?? '#'} target="_blank" rel="noopener noreferrer" className="text-violet-600 underline">
                click here
              </a>
              .
            </p>
            <p className="text-xs text-gray-400">Once authorized, click Done to finish connecting.</p>
            <div className="flex gap-3">
              <button
                onClick={handleDone}
                disabled={complete.isPending}
                className="flex-1 flex items-center justify-center gap-2 h-10 px-5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors"
              >
                {complete.isPending ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                {complete.isPending ? 'Verifying…' : 'Done'}
              </button>
              <button
                onClick={onClose}
                className="h-10 px-4 rounded-xl border border-gray-200 text-sm text-gray-500 hover:border-gray-300 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {phase === 'success' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle size={36} className="text-green-500" />
            <p className="text-sm font-medium text-gray-800">{toolkit.name} connected successfully!</p>
          </div>
        )}

        {phase === 'error' && (
          <>
            <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50 border border-red-100">
              <AlertCircle size={16} className="text-red-500 flex-none mt-0.5" />
              <p className="text-sm text-red-700">{errorMsg}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleConnect}
                className="flex-1 flex items-center justify-center gap-2 h-10 px-5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors"
              >
                Try again
              </button>
              <button
                onClick={onClose}
                className="h-10 px-4 rounded-xl border border-gray-200 text-sm text-gray-500 hover:border-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Toolkit cards ────────────────────────────────────────────────────────────

const ToolkitCard = memo(function ToolkitCard({ toolkit, onConnect }: { toolkit: ToolkitItem; onConnect: (t: ToolkitItem) => void }) {
  return (
    <button
      type="button"
      onClick={() => onConnect(toolkit)}
      className="flex-none w-36 flex flex-col items-center gap-2 p-3 rounded-2xl border border-gray-100 bg-white hover:border-violet-200 hover:shadow-sm transition-all cursor-pointer select-none text-left"
    >
      <ToolkitLogo src={toolkit.logo} name={toolkit.name} />
      <span className="text-xs font-medium text-gray-700 text-center leading-tight line-clamp-2">{toolkit.name}</span>
    </button>
  );
});

const ConnectedCard = memo(function ConnectedCard({ toolkit, onDisconnect }: { toolkit: ConnectedToolkit; onDisconnect: (id: string) => void }) {
  return (
    <div className="flex-none w-36 flex flex-col items-center gap-2 p-3 rounded-2xl border border-green-100 bg-green-50/60 select-none group relative">
      <ToolkitLogo src={toolkit.logo} name={toolkit.name} />
      <span className="text-xs font-medium text-gray-700 text-center leading-tight line-clamp-2">{toolkit.name}</span>
      <span className="text-[10px] font-semibold text-green-600 bg-white px-2 py-0.5 rounded-full border border-green-100">Connected</span>
      <button
        type="button"
        onClick={() => onDisconnect(toolkit.id)}
        className="absolute top-1.5 right-1.5 p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
        title="Disconnect"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
});

// ─── Toolkit rows ─────────────────────────────────────────────────────────────

interface RowData {
  title: string;
  toolkits: ToolkitItem[];
  isConnectedRow?: boolean;
  connectedToolkits?: ConnectedToolkit[];
  onConnect?: (t: ToolkitItem) => void;
  onDisconnect?: (id: string) => void;
}

const ToolkitRow = memo(function ToolkitRow({ row }: { row: RowData }) {
  if (row.isConnectedRow) {
    if (!row.connectedToolkits?.length) return null;
    return (
      <div style={{ contentVisibility: 'auto', containIntrinsicSize: '0 176px' }}>
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3 px-1">{row.title}</h3>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
          {row.connectedToolkits.map((c) => (
            <ConnectedCard key={c.id} toolkit={c} onDisconnect={row.onDisconnect!} />
          ))}
        </div>
      </div>
    );
  }
  if (!row.toolkits.length) return null;
  return (
    <div style={{ contentVisibility: 'auto', containIntrinsicSize: '0 176px' }}>
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3 px-1">{row.title}</h3>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
        {row.toolkits.map((t) => <ToolkitCard key={t.slug} toolkit={t} onConnect={row.onConnect!} />)}
      </div>
    </div>
  );
});

// ─── Category pill grid ───────────────────────────────────────────────────────

const ROWS = 4;

interface CategoryPillGridProps {
  categories: string[];
  selected: string | null;
  onSelect: (v: string | null) => void;
}

function CategoryPillGrid({ categories, selected, onSelect }: CategoryPillGridProps) {
  const [catSearch, setCatSearch] = useState('');
  const [expanded, setExpanded] = useState(false);

  const visible = useMemo(() => {
    const q = catSearch.toLowerCase();
    return q ? categories.filter((c) => c.toLowerCase().includes(q)) : categories;
  }, [categories, catSearch]);

  const strips = useMemo(() => {
    const s: (string | null)[][] = Array.from({ length: ROWS }, () => []);
    s[0].push(null);
    visible.forEach((cat, i) => { s[(i + 1) % ROWS].push(cat); });
    return s;
  }, [visible]);

  function handleSearch(v: string) {
    setCatSearch(v);
    if (v && !expanded) setExpanded(true);
  }

  function Pill({ cat }: { cat: string | null }) {
    const isActive = cat === selected;
    return (
      <button
        type="button"
        onClick={() => onSelect(isActive && cat !== null ? null : cat)}
        className={`flex-none h-8 px-4 rounded-full text-xs font-bold uppercase tracking-wide whitespace-nowrap transition-colors ${
          isActive
            ? 'bg-violet-600 text-white'
            : 'bg-gray-100 text-gray-500 hover:bg-violet-50 hover:text-violet-600'
        }`}
      >
        {cat ?? 'All'}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 mt-1">
      <div className="flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Filter categories…"
            value={catSearch}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-700 outline-none focus:border-violet-400 focus:bg-white transition-colors"
          />
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 flex-none h-9 px-3 rounded-xl border border-gray-200 bg-gray-50 text-xs text-gray-500 hover:border-violet-300 hover:text-violet-600 transition-colors"
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? 'Hide all' : 'Show all'}
        </button>
      </div>

      {expanded && (
        visible.length === 0 ? (
          <div className="text-xs text-gray-400 py-1">No categories found</div>
        ) : (
          <div className="overflow-x-auto scrollbar-none">
            <div className="flex flex-col gap-2 pb-1">
              {strips.map((strip, ri) => (
                <div key={ri} className="flex gap-2">
                  {strip.map((cat) => <Pill key={cat ?? '__all__'} cat={cat} />)}
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ─── Scrollable row list ──────────────────────────────────────────────────────

function RowList({ rows }: { rows: RowData[] }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="flex-1 overflow-y-auto px-6 py-6" style={{ willChange: 'transform' }}>
      <div className="flex flex-col gap-6">
        {rows.map((row, i) => <ToolkitRow key={row.title + i} row={row} />)}
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function ToolkitsView({ onClose }: ToolkitsViewProps) {
  const utils = trpc.useUtils();
  const { data: allToolkits, isLoading: loadingToolkits } = trpc.listToolkits.useQuery({ provider: 'composio' });
  const { data: connectedRaw, isLoading: loadingConnected } = trpc.getUserToolkits.useQuery();

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [connectingToolkit, setConnectingToolkit] = useState<ToolkitItem | null>(null);

  const removeMutation = trpc.removeToolkit.useMutation({
    onSuccess: () => utils.getUserToolkits.invalidate(),
  });

  const connected: ConnectedToolkit[] = useMemo(() =>
    (connectedRaw ?? []).map((t: any) => ({
      id: t.id,
      toolkitSlug: t.toolkitSlug,
      name: t.name,
      logo: t.logo,
      provider: t.provider,
    })),
    [connectedRaw],
  );

  const connectedSlugs = useMemo(() => new Set(connected.map((c) => c.toolkitSlug)), [connected]);
  const toolkitList: ToolkitItem[] = allToolkits ?? [];

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const t of toolkitList) {
      if (t.categories.length === 0) cats.add('Other');
      else t.categories.forEach((c) => cats.add(c));
    }
    return [...cats].sort((a, b) => a.localeCompare(b));
  }, [toolkitList]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return toolkitList.filter((t) => {
      if (connectedSlugs.has(t.slug)) return false;
      if (q && !t.name.toLowerCase().includes(q)) return false;
      if (selectedCategory) {
        const cats = t.categories.length > 0 ? t.categories : ['Other'];
        if (!cats.includes(selectedCategory)) return false;
      }
      return true;
    });
  }, [toolkitList, connectedSlugs, search, selectedCategory]);

  const handleConnect = useCallback((toolkit: ToolkitItem) => {
    setConnectingToolkit(toolkit);
  }, []);

  const handleDisconnect = useCallback((userToolkitId: string) => {
    removeMutation.mutate({ userToolkitId });
  }, [removeMutation]);

  const handleConnected = useCallback(() => {
    utils.getUserToolkits.invalidate();
  }, [utils]);

  const rows = useMemo(() => {
    const result: RowData[] = [];

    if (connected.length > 0) {
      result.push({
        title: 'Connected',
        toolkits: [],
        isConnectedRow: true,
        connectedToolkits: connected,
        onDisconnect: handleDisconnect,
      });
    }

    if (search || selectedCategory) {
      if (filtered.length > 0) {
        result.push({ title: selectedCategory ?? 'Results', toolkits: filtered, onConnect: handleConnect });
      }
      return result;
    }

    const popular = filtered.filter((t) => POPULAR_SLUGS.includes(t.slug));
    if (popular.length > 0) result.push({ title: 'Popular', toolkits: popular, onConnect: handleConnect });

    const categoryMap = new Map<string, ToolkitItem[]>();
    for (const t of filtered) {
      if (POPULAR_SLUGS.includes(t.slug)) continue;
      const cats = t.categories.length > 0 ? t.categories : ['Other'];
      for (const cat of cats) {
        if (!categoryMap.has(cat)) categoryMap.set(cat, []);
        categoryMap.get(cat)!.push(t);
      }
    }
    for (const [cat, toolkits] of [...categoryMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      result.push({ title: cat, toolkits, onConnect: handleConnect });
    }

    return result;
  }, [connected, filtered, search, selectedCategory, handleConnect, handleDisconnect]);

  const isLoading = loadingToolkits || loadingConnected;

  return (
    <div className="flex flex-col flex-1 h-full bg-gray-50 overflow-hidden min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100 flex-none">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center">
            <Plug size={16} className="text-violet-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Toolkits</h2>
            <p className="text-xs text-gray-500">Connect third-party tools to use them with agents</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* Filter bar */}
      {!isLoading && (
        <div className="flex flex-col gap-3 px-6 py-4 bg-white border-b border-gray-100 flex-none">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search toolkits…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-9 pr-3 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-700 outline-none focus:border-violet-400 focus:bg-white transition-colors"
              />
            </div>
            {(search || selectedCategory) && (
              <button
                type="button"
                onClick={() => { setSearch(''); setSelectedCategory(null); }}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex-none"
              >
                Clear all
              </button>
            )}
          </div>

          <CategoryPillGrid
            categories={allCategories}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
          />
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 gap-3">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">Loading toolkits…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <span className="text-sm">No toolkits found</span>
        </div>
      ) : (
        <RowList rows={rows} />
      )}

      {/* Connect modal */}
      {connectingToolkit && (
        <ConnectModal
          toolkit={connectingToolkit}
          onClose={() => setConnectingToolkit(null)}
          onConnected={handleConnected}
        />
      )}
    </div>
  );
}
