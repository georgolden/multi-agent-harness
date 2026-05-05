import type { AgentTool } from '../types.js';
import { type Static, Type } from '@sinclair/typebox';
import { ToolResultMessage } from '../utils/message.js';

const EXA_MCP_URL = process.env.EXA_API_KEY
  ? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}`
  : 'https://mcp.exa.ai/mcp';

const webSearchSchema = Type.Object({
  query: Type.String({ description: 'Websearch query' }),
  numResults: Type.Optional(
    Type.Number({ description: 'Number of search results to return (default: 8)' }),
  ),
  livecrawl: Type.Optional(
    Type.Union([Type.Literal('fallback'), Type.Literal('preferred')], {
      description:
        "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
    }),
  ),
  type: Type.Optional(
    Type.Union([Type.Literal('auto'), Type.Literal('fast'), Type.Literal('deep')], {
      description:
        "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
    }),
  ),
  contextMaxCharacters: Type.Optional(
    Type.Number({
      description: 'Maximum characters for context string optimized for LLMs (default: 10000)',
    }),
  ),
});

export type WebSearchToolInput = Static<typeof webSearchSchema>;

interface McpResponse {
  result: {
    content: Array<{ type: string; text: string }>;
  };
}

function parseSse(body: string): string | undefined {
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const data = JSON.parse(line.substring(6)) as McpResponse;
      if (data.result?.content?.[0]?.text) {
        return data.result.content[0].text;
      }
    } catch {
      // Ignore invalid JSON lines
    }
  }
  return undefined;
}

export function createWebSearchTool(): AgentTool<typeof webSearchSchema> {
  return {
    name: 'websearch',
    label: 'websearch',
    description: `- Search the web using Exa AI - performs real-time web searches and can scrape content from specific URLs
- Provides up-to-date information for current events and recent data
- Supports configurable result counts and returns the content from the most relevant websites
- Use this tool for accessing information beyond knowledge cutoff
- Searches are performed automatically within a single API call

Usage notes:
  - Supports live crawling modes: 'fallback' (backup if cached unavailable) or 'preferred' (prioritize live crawling)
  - Search types: 'auto' (balanced), 'fast' (quick results), 'deep' (comprehensive search)
  - Configurable context length for optimal LLM integration
  - Domain filtering and advanced search options available

The current year is ${new Date().getFullYear()}. You MUST use this year when searching for recent information or current events
- Example: If the current year is ${new Date().getFullYear()} and the user asks for "latest AI news", search for "AI news ${new Date().getFullYear()}", NOT "AI news ${new Date().getFullYear() - 1}"`,
    parameters: webSearchSchema,
    execute: async (
      _app: any,
      _context: any,
      { query, numResults, livecrawl, type, contextMaxCharacters },
      { toolCallId, signal }: { toolCallId: string; signal?: AbortSignal },
    ) => {
      if (signal?.aborted) {
        return {
          data: new ToolResultMessage({ toolCallId, content: 'Error: Operation aborted' }),
          details: undefined,
          error: new Error('Operation aborted'),
        };
      }

      try {
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), 25000);

        if (signal) {
          signal.addEventListener('abort', () => controller.abort(), { once: true });
        }

        const requestBody = {
          jsonrpc: '2.0' as const,
          id: 1 as const,
          method: 'tools/call' as const,
          params: {
            name: 'web_search_exa',
            arguments: {
              query,
              type: type || 'auto',
              numResults: numResults || 8,
              livecrawl: livecrawl || 'fallback',
              contextMaxCharacters,
            },
          },
        };

        const response = await fetch(EXA_MCP_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutHandle);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const body = await response.text();
        const result = parseSse(body);

        const output =
          result ?? 'No search results found. Please try a different query.';

        return {
          data: new ToolResultMessage({ toolCallId, content: output }),
          details: {
            title: `Web search: ${query}`,
          },
        };
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

/** Default websearch tool instance */
export const webSearchTool = createWebSearchTool();
