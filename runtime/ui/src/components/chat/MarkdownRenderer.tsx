import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { XmlBlock } from './XmlNode.js';

// Splits message content into markdown segments and XML blocks.
// XML blocks are detected as any <tag ...>...</tag> or self-closing <tag /> at
// the top level of the string. Template vars ${...} are left untouched.
function splitContent(content: string): Array<{ type: 'md' | 'xml'; value: string }> {
  const segments: Array<{ type: 'md' | 'xml'; value: string }> = [];
  // Match a top-level XML tag: <tagName ...> ... </tagName> or <tagName ... />
  // We use a simple heuristic: a line that starts with < and a letter, not inside a code block.
  const xmlTagRe = /<([a-zA-Z][a-zA-Z0-9_\-.]*)(\s[^>]*)?(\/?>)([\s\S]*?)<\/\1>|<([a-zA-Z][a-zA-Z0-9_\-.]*)(\s[^>]*)?\/>/g;

  let lastIndex = 0;
  let match;

  while ((match = xmlTagRe.exec(content)) !== null) {
    // Push preceding markdown
    if (match.index > lastIndex) {
      const md = content.slice(lastIndex, match.index);
      if (md) segments.push({ type: 'md', value: md });
    }
    segments.push({ type: 'xml', value: match[0] });
    lastIndex = match.index + match[0].length;
  }

  // Remaining markdown
  if (lastIndex < content.length) {
    const md = content.slice(lastIndex);
    if (md) segments.push({ type: 'md', value: md });
  }

  return segments.length > 0 ? segments : [{ type: 'md', value: content }];
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const segments = splitContent(content);

  return (
    <div className={`markdown-body ${className}`}>
      {segments.map((seg, idx) => {
        if (seg.type === 'xml') {
          return <XmlBlock key={idx} raw={seg.value} />;
        }
        return (
          <ReactMarkdown
            key={idx}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              // Open links in new tab safely
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-800">
                  {children}
                </a>
              ),
              // Code blocks
              pre: ({ children }) => (
                <pre className="bg-gray-900 text-gray-100 rounded-xl p-4 overflow-x-auto text-xs leading-relaxed my-2">
                  {children}
                </pre>
              ),
              code: ({ className: cls, children, ...props }) => {
                const isBlock = !!cls;
                if (isBlock) return <code className={cls} {...props}>{children}</code>;
                return (
                  <code className="bg-gray-100 text-pink-600 rounded px-1 py-0.5 text-[0.85em] font-mono" {...props}>
                    {children}
                  </code>
                );
              },
              // Headings
              h1: ({ children }) => <h1 className="text-lg font-bold text-gray-900 mt-3 mb-1">{children}</h1>,
              h2: ({ children }) => <h2 className="text-base font-semibold text-gray-900 mt-2.5 mb-1">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-semibold text-gray-800 mt-2 mb-0.5">{children}</h3>,
              // Lists
              ul: ({ children }) => <ul className="list-disc pl-5 space-y-0.5 my-1 text-sm">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 space-y-0.5 my-1 text-sm">{children}</ol>,
              li: ({ children, ...props }) => (
                <li className="text-gray-700 leading-relaxed" {...props}>
                  {/* react-markdown wraps loose list content in <p> — unwrap it to keep marker and text on same line */}
                  {Array.isArray(children)
                    ? children.map((child, i) =>
                        child?.type === 'p' ? <span key={i}>{child.props.children}</span> : child
                      )
                    : (children as React.ReactElement)?.type === 'p'
                      ? (children as React.ReactElement).props.children
                      : children}
                </li>
              ),
              // Blockquote
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-gray-200 pl-3 my-2 text-gray-500 italic text-sm">
                  {children}
                </blockquote>
              ),
              // Paragraph
              p: ({ children }) => <p className="text-sm leading-relaxed text-gray-800 my-1">{children}</p>,
              // Table (GFM)
              table: ({ children }) => (
                <div className="overflow-x-auto my-2">
                  <table className="text-xs border-collapse w-full">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-gray-200 bg-gray-50 px-3 py-1.5 text-left font-semibold text-gray-700">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-gray-200 px-3 py-1.5 text-gray-700">{children}</td>
              ),
              // Horizontal rule
              hr: () => <hr className="border-gray-200 my-3" />,
              // Strong / em
              strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
              em: ({ children }) => <em className="italic text-gray-700">{children}</em>,
            }}
          >
            {seg.value}
          </ReactMarkdown>
        );
      })}
    </div>
  );
}
