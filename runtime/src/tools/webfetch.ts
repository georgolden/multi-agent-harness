import type { AgentTool } from '../types.js';
import { type Static, Type } from '@sinclair/typebox';
import { ToolResultMessage } from '../utils/message.js';
import TurndownService from 'turndown';
import { parseHTML } from 'linkedom';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT_MS = 30 * 1000; // 30 seconds
const MAX_TIMEOUT_MS = 120 * 1000; // 2 minutes

const webFetchSchema = Type.Object({
  url: Type.String({ description: 'The URL to fetch content from' }),
  format: Type.Optional(
    Type.Union([Type.Literal('text'), Type.Literal('markdown'), Type.Literal('html')], {
      description: 'The format to return the content in (text, markdown, or html). Defaults to markdown.',
    }),
  ),
  timeout: Type.Optional(
    Type.Number({ description: 'Optional timeout in seconds (max 120)' }),
  ),
});

export type WebFetchToolInput = Static<typeof webFetchSchema>;

function isImageAttachment(mime: string): boolean {
  return mime.startsWith('image/') && mime !== 'image/svg+xml' && mime !== 'image/vnd.fastbidsheet';
}

function extractTextFromHTML(html: string): string {
  const { document } = parseHTML(html);
  const scripts = document.querySelectorAll('script, style, noscript, iframe, object, embed');
  scripts.forEach((el) => el.remove());
  return (document.body?.textContent || document.textContent || '').trim();
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });
  turndownService.remove(['script', 'style', 'meta', 'link']);
  return turndownService.turndown(html);
}

export function createWebFetchTool(): AgentTool<typeof webFetchSchema> {
  return {
    name: 'webfetch',
    label: 'webfetch',
    description:
      '- Fetches content from a specified URL\n- Takes a URL and optional format as input\n- Fetches the URL content, converts to requested format (markdown by default)\n- Returns the content in the specified format\n- Use this tool when you need to retrieve and analyze web content\n\nUsage notes:\n  - IMPORTANT: if another tool is present that offers better web fetching capabilities, is more targeted to the task, or has fewer restrictions, prefer using that tool instead of this one.\n  - The URL must be a fully-formed valid URL\n  - HTTP URLs will be automatically upgraded to HTTPS\n  - Format options: "markdown" (default), "text", or "html"\n  - This tool is read-only and does not modify any files\n  - Results may be summarized if the content is very large',
    parameters: webFetchSchema,
    execute: async (
      _app: any,
      _context: any,
      { url, format, timeout },
      { toolCallId, signal }: { toolCallId: string; signal?: AbortSignal },
    ) => {
      if (signal?.aborted) {
        return {
          data: new ToolResultMessage({ toolCallId, content: 'Error: Operation aborted' }),
          details: undefined,
          error: new Error('Operation aborted'),
        };
      }

      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return {
          data: new ToolResultMessage({ toolCallId, content: 'Error: URL must start with http:// or https://' }),
          details: undefined,
          error: new Error('URL must start with http:// or https://'),
        };
      }

      const effectiveFormat = format || 'markdown';
      const effectiveTimeout = Math.min((timeout ?? DEFAULT_TIMEOUT_MS / 1000) * 1000, MAX_TIMEOUT_MS);

      // Build Accept header based on requested format with q parameters for fallbacks
      let acceptHeader = '*/*';
      switch (effectiveFormat) {
        case 'markdown':
          acceptHeader = 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1';
          break;
        case 'text':
          acceptHeader = 'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1';
          break;
        case 'html':
          acceptHeader =
            'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1';
          break;
        default:
          acceptHeader =
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';
      }

      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        Accept: acceptHeader,
        'Accept-Language': 'en-US,en;q=0.9',
      };

      try {
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), effectiveTimeout);

        if (signal) {
          signal.addEventListener('abort', () => controller.abort(), { once: true });
        }

        let response: Response;
        try {
          response = await fetch(url, {
            headers,
            signal: controller.signal,
          });
        } catch (err) {
          clearTimeout(timeoutHandle);
          throw err;
        }

        // Retry with honest UA if blocked by Cloudflare bot detection
        if (
          response.status === 403 &&
          response.headers.get('cf-mitigated') === 'challenge'
        ) {
          response = await fetch(url, {
            headers: { ...headers, 'User-Agent': 'opencode' },
            signal: controller.signal,
          });
        }

        clearTimeout(timeoutHandle);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Check content length
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
          throw new Error('Response too large (exceeds 5MB limit)');
        }

        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
          throw new Error('Response too large (exceeds 5MB limit)');
        }

        const contentType = response.headers.get('content-type') || '';
        const mime = contentType.split(';')[0]?.trim().toLowerCase() || '';
        const title = `${url} (${contentType})`;

        if (isImageAttachment(mime)) {
          const base64Content = Buffer.from(arrayBuffer).toString('base64');
          return {
            data: new ToolResultMessage({
              toolCallId,
              content: 'Image fetched successfully',
            }),
            details: {
              title,
              attachments: [
                {
                  type: 'file' as const,
                  mime,
                  url: `data:${mime};base64,${base64Content}`,
                },
              ],
            },
          };
        }

        const content = new TextDecoder().decode(arrayBuffer);

        switch (effectiveFormat) {
          case 'markdown': {
            if (contentType.includes('text/html')) {
              const markdown = convertHTMLToMarkdown(content);
              return {
                data: new ToolResultMessage({ toolCallId, content: markdown }),
                details: { title, format: effectiveFormat },
              };
            }
            return {
              data: new ToolResultMessage({ toolCallId, content: content }),
              details: { title, format: effectiveFormat },
            };
          }
          case 'text': {
            if (contentType.includes('text/html')) {
              const text = extractTextFromHTML(content);
              return {
                data: new ToolResultMessage({ toolCallId, content: text }),
                details: { title, format: effectiveFormat },
              };
            }
            return {
              data: new ToolResultMessage({ toolCallId, content: content }),
              details: { title, format: effectiveFormat },
            };
          }
          case 'html': {
            return {
              data: new ToolResultMessage({ toolCallId, content: content }),
              details: { title, format: effectiveFormat },
            };
          }
          default: {
            return {
              data: new ToolResultMessage({ toolCallId, content: content }),
              details: { title, format: effectiveFormat },
            };
          }
        }
      } catch (error: any) {
        const err = error instanceof Error ? error : new Error(String(error));
        return {
          data: new ToolResultMessage({ toolCallId, content: `Error: ${err.message}` }),
          details: undefined,
          error: err,
        };
      }
    },
  };
}

/** Default webfetch tool instance */
export const webFetchTool = createWebFetchTool();
