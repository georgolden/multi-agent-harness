import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface XmlElement {
  type: 'element';
  tagName: string;
  attributes: Record<string, string>;
  children: XmlNode[];
}

interface XmlText {
  type: 'text';
  value: string;
}

type XmlNode = XmlElement | XmlText;

// Minimal XML parser — handles tags, attributes, text, and nesting.
// Does not handle CDATA, processing instructions, or comments.
function parseXml(input: string): XmlNode[] {
  const nodes: XmlNode[] = [];
  let i = 0;

  function parseAttrs(raw: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re = /(\w[\w\-.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
    }
    return attrs;
  }

  function parseNodes(stopTag?: string): XmlNode[] {
    const result: XmlNode[] = [];

    while (i < input.length) {
      if (input[i] === '<') {
        // Closing tag
        if (input[i + 1] === '/') {
          const end = input.indexOf('>', i);
          if (end === -1) break;
          i = end + 1;
          break;
        }
        // Opening tag
        const end = input.indexOf('>', i);
        if (end === -1) break;
        const tagContent = input.slice(i + 1, end);
        const selfClosing = tagContent.endsWith('/');
        const inner = selfClosing ? tagContent.slice(0, -1).trim() : tagContent;
        const spaceIdx = inner.search(/\s/);
        const tagName = spaceIdx === -1 ? inner : inner.slice(0, spaceIdx);
        const attrStr = spaceIdx === -1 ? '' : inner.slice(spaceIdx + 1);
        const attributes = parseAttrs(attrStr);
        i = end + 1;

        if (selfClosing) {
          result.push({ type: 'element', tagName, attributes, children: [] });
        } else {
          const children = parseNodes(tagName);
          result.push({ type: 'element', tagName, attributes, children });
        }
      } else {
        // Text node
        const next = input.indexOf('<', i);
        const text = next === -1 ? input.slice(i) : input.slice(i, next);
        if (text) result.push({ type: 'text', value: text });
        i = next === -1 ? input.length : next;
      }
    }

    return result;
  }

  const result = parseNodes();
  return result;
}

function hasElementChildren(node: XmlElement): boolean {
  return node.children.some((c) => c.type === 'element');
}

function textLength(node: XmlElement): number {
  return node.children
    .filter((c): c is XmlText => c.type === 'text')
    .reduce((acc, t) => acc + t.value.length, 0);
}

function shouldDefaultCollapse(node: XmlElement): boolean {
  return hasElementChildren(node) || textLength(node) > 200;
}

function AttributePills({ attrs }: { attrs: Record<string, string> }) {
  const entries = Object.entries(attrs);
  if (entries.length === 0) return null;
  return (
    <span className="ml-2 inline-flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <span key={k} className="text-[10px] font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
          {k}{v ? <><span className="text-gray-600">=</span><span className="text-indigo-500">{v}</span></> : null}
        </span>
      ))}
    </span>
  );
}

function XmlElementNode({ node, depth }: { node: XmlElement; depth: number }) {
  const collapsible = hasElementChildren(node) || textLength(node) > 200;
  const [collapsed, setCollapsed] = useState(() => shouldDefaultCollapse(node) && depth > 0);

  const hasChildren = node.children.length > 0;
  const onlyText = hasChildren && !hasElementChildren(node);

  const tagLabel = (
    <span className="inline-flex items-center gap-1">
      <span className="text-[11px] font-semibold font-mono text-violet-600 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded">
        {node.tagName}
      </span>
      <AttributePills attrs={node.attributes} />
    </span>
  );

  if (!hasChildren) {
    return (
      <div className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: depth * 16 }}>
        <span className="w-3 flex-shrink-0" />
        {tagLabel}
      </div>
    );
  }

  if (onlyText) {
    const text = (node.children as XmlText[]).map((c) => c.value).join('').trim();
    const long = text.length > 200;

    return (
      <div style={{ paddingLeft: depth * 16 }}>
        {long ? (
          <>
            <button
              className="flex items-center gap-1 py-0.5 hover:opacity-70 transition-opacity"
              onClick={() => setCollapsed((p) => !p)}
            >
              {collapsed ? <ChevronRight size={12} className="text-gray-600" /> : <ChevronDown size={12} className="text-gray-600" />}
              {tagLabel}
            </button>
            {!collapsed && (
              <div className="ml-5 mt-0.5 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap border-l-2 border-violet-100 pl-3 py-1">
                {text}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-start gap-2 py-0.5">
            <span className="w-3 flex-shrink-0" />
            <span className="flex items-baseline gap-2 flex-wrap">
              {tagLabel}
              <span className="text-sm text-gray-700 leading-relaxed">{text}</span>
            </span>
          </div>
        )}
      </div>
    );
  }

  // Has element children
  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <button
        className="flex items-center gap-1 py-0.5 hover:opacity-70 transition-opacity"
        onClick={() => setCollapsed((p) => !p)}
      >
        {collapsed ? <ChevronRight size={12} className="text-gray-600" /> : <ChevronDown size={12} className="text-gray-600" />}
        {tagLabel}
      </button>
      {!collapsed && (
        <div className="mt-0.5">
          {node.children.map((child, idx) => (
            <XmlNodeRenderer key={idx} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function XmlNodeRenderer({ node, depth }: { node: XmlNode; depth: number }) {
  if (node.type === 'text') {
    const text = node.value.trim();
    if (!text) return null;
    return (
      <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap py-0.5" style={{ paddingLeft: depth * 16 }}>
        {text}
      </div>
    );
  }
  return <XmlElementNode node={node} depth={depth} />;
}

interface XmlBlockProps {
  raw: string;
}

export function XmlBlock({ raw }: XmlBlockProps) {
  const nodes = parseXml(raw.trim());
  if (nodes.length === 0) return <span className="text-gray-500 font-mono text-xs">{raw}</span>;

  return (
    <div className="my-2 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5 text-sm">
      {nodes.map((node, idx) => (
        <XmlNodeRenderer key={idx} node={node} depth={0} />
      ))}
    </div>
  );
}
