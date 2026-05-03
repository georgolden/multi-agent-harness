import type { AgentTool } from '../types.js';
import type { ImageContent, TextContent } from '../types.js';
import { type Static, Type } from '@sinclair/typebox';
import { constants } from 'fs';
import { access as fsAccess, readFile as fsReadFile, readdir as fsReaddir, stat as fsStat } from 'fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { formatDimensionNote, resizeImage } from '../utils/image-resize.js';
import { detectSupportedImageMimeTypeFromFile } from '../utils/mime.js';
import { ToolResultMessage } from '../utils/message.js';
import { resolveReadPath } from './path-utils.js';
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from './truncate.js';
import { App } from '../app.js';

const MAX_LINE_LENGTH = 2000;
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`;
const MAX_BYTES = DEFAULT_MAX_BYTES;
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`;
const SAMPLE_BYTES = 4096;
const SUPPORTED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const readSchema = Type.Object({
  filePath: Type.String({ description: 'The absolute path to the file or directory to read' }),
  offset: Type.Optional(Type.Number({ description: 'The line number to start reading from (1-indexed)' })),
  limit: Type.Optional(Type.Number({ description: 'The maximum number of lines to read (defaults to 2000)' })),
});

export type ReadToolInput = Static<typeof readSchema>;

export interface ReadToolDetails {
  truncation?: { truncated: boolean; outputLines: number; totalLines: number };
}

/**
 * Pluggable operations for the read tool.
 * Override these to delegate file reading to remote systems (e.g., SSH).
 */
export interface ReadOperations {
  /** Read file contents as a Buffer */
  readFile: (absolutePath: string) => Promise<Buffer>;
  /** Check if file is readable (throw if not) */
  access: (absolutePath: string) => Promise<void>;
  /** Read directory entries */
  readdir: (absolutePath: string) => Promise<string[]>;
  /** Stat a path */
  stat: (absolutePath: string) => Promise<{ isDirectory: () => boolean; isFile: () => boolean; size: number }>;
  /** Detect image MIME type, return null/undefined for non-images */
  detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}

const defaultReadOperations: ReadOperations = {
  readFile: (p) => fsReadFile(p),
  access: (p) => fsAccess(p, constants.R_OK),
  readdir: (p) => fsReaddir(p),
  stat: async (p) => {
    const s = await fsStat(p);
    return { isDirectory: () => s.isDirectory(), isFile: () => s.isFile(), size: s.size };
  },
  detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};

export interface ReadToolOptions {
  /** Whether to auto-resize images to 2000x2000 max. Default: true */
  autoResizeImages?: boolean;
  /** Custom operations for file reading. Default: local filesystem */
  operations?: ReadOperations;
}

function isBinaryFile(filePath: string, bytes: Uint8Array): boolean {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.zip':
    case '.tar':
    case '.gz':
    case '.exe':
    case '.dll':
    case '.so':
    case '.class':
    case '.jar':
    case '.war':
    case '.7z':
    case '.doc':
    case '.docx':
    case '.xls':
    case '.xlsx':
    case '.ppt':
    case '.pptx':
    case '.odt':
    case '.ods':
    case '.odp':
    case '.bin':
    case '.dat':
    case '.obj':
    case '.o':
    case '.a':
    case '.lib':
    case '.wasm':
    case '.pyc':
    case '.pyo':
      return true;
  }

  if (bytes.length === 0) return false;

  let nonPrintableCount = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true;
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++;
    }
  }

  return nonPrintableCount / bytes.length > 0.3;
}

async function readSample(filePath: string, fileSize: number): Promise<Uint8Array> {
  if (fileSize === 0) return new Uint8Array();
  const stream = createReadStream(filePath, { start: 0, end: Math.min(SAMPLE_BYTES, fileSize) - 1 });
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function readLines(filePath: string, opts: { limit: number; offset: number }) {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  const start = opts.offset - 1;
  const raw: string[] = [];
  let bytes = 0;
  let count = 0;
  let cut = false;
  let more = false;

  try {
    for await (const text of rl) {
      count += 1;
      if (count <= start) continue;

      if (raw.length >= opts.limit) {
        more = true;
        continue;
      }

      const line = text.length > MAX_LINE_LENGTH ? text.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : text;
      const size = Buffer.byteLength(line, 'utf-8') + (raw.length > 0 ? 1 : 0);
      if (bytes + size > MAX_BYTES) {
        cut = true;
        more = true;
        break;
      }

      raw.push(line);
      bytes += size;
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return { raw, count, cut, more, offset: opts.offset };
}

export function createReadTool(cwd: string, options?: ReadToolOptions): AgentTool<typeof readSchema> {
  const autoResizeImages = options?.autoResizeImages ?? true;
  const ops = options?.operations ?? defaultReadOperations;

  return {
    name: 'read',
    label: 'read',
    description: `Read the contents of a file or list a directory. Supports text files and images (jpg, png, gif, webp). For text files, output includes line numbers and is truncated to ${DEFAULT_MAX_LINES} lines or ${MAX_BYTES_LABEL} (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    parameters: readSchema,
    execute: async (
      _app: App,
      _context: any,
      { filePath, offset, limit },
      { toolCallId, signal }: { toolCallId: string; signal?: AbortSignal },
    ) => {
      if (signal?.aborted) {
        return {
          data: new ToolResultMessage({ toolCallId, content: 'Error: Operation aborted' }),
          details: undefined,
          error: new Error('Operation aborted'),
        };
      }

      const absolutePath = resolveReadPath(filePath, cwd);

      try {
        // Stat the path
        let stat: { isDirectory: () => boolean; isFile: () => boolean; size: number } | undefined;
        try {
          stat = await ops.stat(absolutePath);
        } catch {
          // File not found — try to suggest alternatives
          const dir = path.dirname(absolutePath);
          const base = path.basename(absolutePath);
          let suggestions: string[] = [];
          try {
            const items = await ops.readdir(dir);
            suggestions = items
              .filter(
                (item) =>
                  item.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(item.toLowerCase()),
              )
              .map((item) => path.join(dir, item))
              .slice(0, 3);
          } catch {
            // ignore
          }

          if (suggestions.length > 0) {
            throw new Error(`File not found: ${absolutePath}\n\nDid you mean one of these?\n${suggestions.join('\n')}`);
          }
          throw new Error(`File not found: ${absolutePath}`);
        }

        if (stat.isDirectory()) {
          const items = await ops.readdir(absolutePath);
          const sorted = items.sort((a, b) => a.localeCompare(b));
          const effectiveLimit = limit ?? DEFAULT_MAX_LINES;
          const effectiveOffset = offset ?? 1;
          const start = effectiveOffset - 1;
          const sliced = sorted.slice(start, start + effectiveLimit);
          const truncated = start + sliced.length < sorted.length;

          const formatted = await Promise.all(
            sliced.map(async (item) => {
              try {
                const itemStat = await ops.stat(path.join(absolutePath, item));
                return itemStat.isDirectory() ? item + '/' : item;
              } catch {
                return item;
              }
            }),
          );

          const output = [
            `<path>${absolutePath}</path>`,
            `<type>directory</type>`,
            `<entries>`,
            formatted.join('\n'),
            truncated
              ? `\n(Showing ${sliced.length} of ${sorted.length} entries. Use 'offset' parameter to read beyond entry ${effectiveOffset + sliced.length})`
              : `\n(${sorted.length} entries)`,
            `</entries>`,
          ].join('\n');

          return {
            data: new ToolResultMessage({ toolCallId, content: output }),
            details: { truncation: { truncated, outputLines: sliced.length, totalLines: sorted.length } },
          };
        }

        if (!stat.isFile()) {
          throw new Error(`Path is not a file: ${absolutePath}`);
        }

        // Check if image
        const mimeType = ops.detectImageMimeType ? await ops.detectImageMimeType(absolutePath) : undefined;
        const isImage = mimeType && SUPPORTED_IMAGE_MIMES.has(mimeType);

        if (isImage) {
          const buffer = await ops.readFile(absolutePath);
          const base64 = buffer.toString('base64');

          if (autoResizeImages) {
            const resized = await resizeImage({ type: 'image', data: base64, mimeType });
            const dimensionNote = formatDimensionNote(resized);
            let textNote = `Read image file [${resized.mimeType}]`;
            if (dimensionNote) {
              textNote += `\n${dimensionNote}`;
            }
            const content: (TextContent | ImageContent)[] = [
              { type: 'text', text: textNote },
              { type: 'image', data: resized.data, mimeType: resized.mimeType },
            ];
            return {
              data: new ToolResultMessage({
                toolCallId,
                content: content.map((c) => (c.type === 'text' ? c.text : `[Image: ${c.mimeType}]`)).join('\n'),
              }),
              details: { truncation: { truncated: false, outputLines: 1, totalLines: 1 } },
            };
          } else {
            const textNote = `Read image file [${mimeType}]`;
            const content: (TextContent | ImageContent)[] = [
              { type: 'text', text: textNote },
              { type: 'image', data: base64, mimeType },
            ];
            return {
              data: new ToolResultMessage({
                toolCallId,
                content: content.map((c) => (c.type === 'text' ? c.text : `[Image: ${c.mimeType}]`)).join('\n'),
              }),
              details: { truncation: { truncated: false, outputLines: 1, totalLines: 1 } },
            };
          }
        }

        // Sample for binary detection
        const sample = await readSample(absolutePath, stat.size);
        if (isBinaryFile(absolutePath, sample)) {
          throw new Error(`Cannot read binary file: ${absolutePath}`);
        }

        const effectiveLimit = limit ?? DEFAULT_MAX_LINES;
        const effectiveOffset = offset ?? 1;

        if (effectiveOffset < 1) {
          throw new Error('offset must be greater than or equal to 1');
        }

        const file = await readLines(absolutePath, { limit: effectiveLimit, offset: effectiveOffset });

        if (file.count < file.offset && !(file.count === 0 && file.offset === 1)) {
          throw new Error(`Offset ${file.offset} is out of range for this file (${file.count} lines)`);
        }

        let output = [`<path>${absolutePath}</path>`, `<type>file</type>`, '<content>\n'].join('\n');
        output += file.raw.map((line, i) => `${i + file.offset}: ${line}`).join('\n');

        const last = file.offset + file.raw.length - 1;
        const next = last + 1;
        const truncated = file.more || file.cut;
        if (file.cut) {
          output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${file.offset}-${last}. Use offset=${next} to continue.)`;
        } else if (file.more) {
          output += `\n\n(Showing lines ${file.offset}-${last} of ${file.count}. Use offset=${next} to continue.)`;
        } else {
          output += `\n\n(End of file - total ${file.count} lines)`;
        }
        output += '\n</content>';

        return {
          data: new ToolResultMessage({ toolCallId, content: output }),
          details: {
            truncation: {
              truncated,
              outputLines: file.raw.length,
              totalLines: file.count,
            },
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

/** Default read tool using process.cwd() - for backwards compatibility */
export const readTool = createReadTool(process.cwd());
