import type { AgentTool, AgentToolResult } from '../types.js';
import { type Static, Type } from '@sinclair/typebox';
import { execFile } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { ToolResultMessage } from '../utils/message.js';
import { resolveToCwd } from './path-utils.js';
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from './truncate.js';
import { App } from '../app.js';

const DEFAULT_FILE_LIMIT = 400;
const DEFAULT_LEVEL = 4;

/**
 * Default ignore patterns for common bloat/generated/vendor folders across
 * popular languages and frameworks.
 */
export const DEFAULT_TREE_IGNORE: string[] = [
  // Python bytecode / package manager cache
  '__pycache__',
  '__pypackages__',
  // Version control
  '.git',
  '.svn',
  '.hg',
  // Node / JS / TS
  'node_modules',
  'dist',
  '.next',
  '.nuxt',
  '.turbo',
  '.vercel',
  '.parcel-cache',
  '.nyc_output',
  '.cache',
  '__snapshots__',
  // Build outputs
  'build',
  'out',
  // Rust
  'target',
  // Java / Kotlin / Gradle / Maven
  '.gradle',
  '.idea',
  // Go, Ruby, PHP
  'vendor',
  '.bundle',
  // Python virtualenvs
  '.venv',
  'venv',
  '.virtualenv',
  'env',
  '.env',
  // Python tool caches
  '.pytest_cache',
  '.hypothesis',
  '.benchmarks',
  '.mypy_cache',
  '.ruff_cache',
  '.pytype',
  '.pyre',
  '.dmypy',
  '.tox',
  // Python packaging artifacts
  'htmlcov',
  '*.egg-info',
  '*.dist-info',
  '*.egg-link',
  'site-packages',
  'lib64',
  // C / C++ / CMake
  'cmake-build-debug',
  'cmake-build-release',
  '.cmake',
  // Coverage / test artifacts
  'coverage',
  // Terraform
  '.terraform',
  // iOS / Xcode
  'Pods',
  'DerivedData',
  'xcuserdata',
  'Carthage',
  '.build',
  '.swiftpm',
  // Android
  '.cxx',
  'captures',
  // Flutter / Dart
  '.dart_tool',
  '.pub-cache',
  '.flutter-plugins',
  '.flutter-plugins-dependencies',
  // React Native / Expo
  '.expo',
  // Misc
  'tmp',
  'temp',
  '.DS_Store',
];

const treeSchema = Type.Object({
  path: Type.Optional(Type.String({ description: 'Directory to tree (default: current directory)' })),
  level: Type.Optional(Type.Number({ description: `Max depth level (default: ${DEFAULT_LEVEL})` })),
  ignore: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Additional patterns to ignore (merged with defaults). Supports glob wildcards.',
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: `Max files shown per directory before truncating (default: ${DEFAULT_FILE_LIMIT})`,
    }),
  ),
});

export type TreeToolInput = Static<typeof treeSchema>;

export interface TreeToolDetails {
  command: string;
}

export interface TreeToolOptions {
  /** Override default ignore patterns entirely */
  defaultIgnore?: string[];
}

export interface RunTreeOptions {
  level?: number;
  ignore?: string[];
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Check if a file/directory name matches any of the ignore patterns.
 * Supports simple glob wildcards (* and ?).
 */
function matchesIgnore(name: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (simpleGlobMatch(name, pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Simple glob matcher supporting * (any chars) and ? (single char).
 */
function simpleGlobMatch(name: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
  );
  return regex.test(name);
}

interface TreeEntry {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  children?: TreeEntry[];
}

/**
 * Pure-JS tree generator used when the system `tree` command is unavailable.
 * Produces output similar to the `tree` command.
 */
function generateTreeFallback(
  dirPath: string,
  options: { level: number; limit: number; ignore: string[] },
): string {
  const baseName = path.basename(dirPath) || dirPath;
  const lines: string[] = [baseName];

  const entries = readDirEntries(dirPath, options);
  renderEntries(lines, entries, '', options);

  return lines.join('\n');
}

function readDirEntries(dirPath: string, options: { level: number; limit: number; ignore: string[] }): TreeEntry[] {
  try {
    const names = readdirSync(dirPath);
    const filtered = names.filter((name) => !matchesIgnore(name, options.ignore));

    const entries: TreeEntry[] = filtered
      .map((name) => {
        const fullPath = path.join(dirPath, name);
        try {
          const isDirectory = statSync(fullPath).isDirectory();
          return { name, fullPath, isDirectory };
        } catch {
          return null;
        }
      })
      .filter((e): e is TreeEntry => e !== null);

    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return entries;
  } catch {
    return [];
  }
}

function renderEntries(
  lines: string[],
  entries: TreeEntry[],
  prefix: string,
  options: { level: number; limit: number; ignore: string[] },
  currentDepth: number = 1,
): void {
  if (currentDepth > options.level) {
    return;
  }

  const effectiveLimit = options.limit;
  const shown = entries.slice(0, effectiveLimit);
  const hidden = entries.length - shown.length;

  for (let i = 0; i < shown.length; i++) {
    const entry = shown[i];
    const isLast = i === shown.length - 1 && hidden === 0;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';

    lines.push(`${prefix}${connector}${entry.name}`);

    if (entry.isDirectory) {
      const children = readDirEntries(entry.fullPath, options);
      renderEntries(lines, children, prefix + childPrefix, options, currentDepth + 1);
    }
  }

  if (hidden > 0) {
    lines.push(`${prefix}└── [${hidden} entries exceeds limit, not shown]`);
  }
}

/**
 * Truncates tree output and appends a notice if needed.
 */
function truncateTreeOutput(text: string): { content: string; truncated: boolean } {
  const result = truncateHead(text, { maxLines: Number.MAX_SAFE_INTEGER, maxBytes: DEFAULT_MAX_BYTES });
  if (!result.truncated) {
    return { content: text, truncated: false };
  }

  const notice = `\n\n[${formatSize(DEFAULT_MAX_BYTES)} limit reached]`;
  return { content: result.content + notice, truncated: true };
}

/**
 * Runs the `tree` command on a directory and returns the raw output string.
 * Merges DEFAULT_TREE_IGNORE with any extra patterns passed in `ignore`.
 * Falls back to a pure-JS implementation if the system `tree` command is not available.
 */
export function runTreeCommand(dirPath: string, options?: RunTreeOptions): Promise<string> {
  const effectiveLevel = options?.level ?? DEFAULT_LEVEL;
  const effectiveLimit = options?.limit ?? DEFAULT_FILE_LIMIT;
  const allIgnore = [...DEFAULT_TREE_IGNORE, ...(options?.ignore ?? [])];
  const ignorePattern = allIgnore.join('|');
  const signal = options?.signal;

  const args: string[] = [
    '-L',
    String(effectiveLevel),
    '--filelimit',
    String(effectiveLimit),
    '-I',
    ignorePattern,
    '--dirsfirst',
    dirPath,
  ];

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Operation aborted'));
      return;
    }

    const proc = execFile('tree', args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (signal?.aborted) {
        reject(new Error('Operation aborted'));
        return;
      }
      if (err && !stdout) {
        // If tree command is not found (ENOENT), fall back to JS implementation
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          try {
            const fallback = generateTreeFallback(dirPath, { level: effectiveLevel, limit: effectiveLimit, ignore: allIgnore });
            resolve(fallback);
          } catch (fallbackErr: any) {
            reject(new Error(`tree failed and fallback also failed: ${fallbackErr.message}`));
          }
          return;
        }
        reject(new Error(`tree failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout || stderr);
    });

    signal?.addEventListener('abort', () => proc.kill(), { once: true });
  });
}

export function createTreeTool(cwd: string, options?: TreeToolOptions): AgentTool<typeof treeSchema, TreeToolDetails | undefined> {
  const baseIgnore = options?.defaultIgnore ?? DEFAULT_TREE_IGNORE;

  return {
    name: 'tree',
    label: 'tree',
    description: `Display directory tree structure. Uses the system \`tree\` command with a pure-JS fallback. Defaults to depth ${DEFAULT_LEVEL} and ignores common bloat folders (node_modules, target, __pycache__, dist, .git, venv, vendor, etc.). Output capped at ${DEFAULT_FILE_LIMIT} files per directory and ${formatSize(DEFAULT_MAX_BYTES)}.`,
    parameters: treeSchema,
    execute: async (
      _app: App,
      _context: unknown,
      { path, level, ignore, limit }: TreeToolInput,
      { toolCallId, signal }: { toolCallId: string; signal?: AbortSignal },
    ) => {
      const dirPath = resolveToCwd(path || '.', cwd);

      if (!existsSync(dirPath)) {
        const error = new Error(`Path not found: ${dirPath}`);
        return {
          data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
          details: undefined,
          error,
        };
      }

      const effectiveLevel = level ?? DEFAULT_LEVEL;
      const effectiveLimit = limit ?? DEFAULT_FILE_LIMIT;
      const allIgnore = [...baseIgnore, ...(ignore ?? [])];
      const ignorePattern = allIgnore.join('|');

      const args: string[] = [
        '-L',
        String(effectiveLevel),
        '--filelimit',
        String(effectiveLimit),
        '-I',
        ignorePattern,
        '--dirsfirst',
        dirPath,
      ];

      const command = `tree ${args.map((a) => (a.includes(' ') || a.includes('|') ? `'${a}'` : a)).join(' ')}`;

      return new Promise<AgentToolResult<TreeToolDetails | undefined>>((resolve) => {
        if (signal?.aborted) {
          const error = new Error('Operation aborted');
          resolve({
            data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
            details: undefined,
            error,
          });
          return;
        }

        const proc = execFile('tree', args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (signal?.aborted) {
            const error = new Error('Operation aborted');
            resolve({
              data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
              details: undefined,
              error,
            });
            return;
          }

          let text: string;

          // tree exits non-zero when filelimit is hit in some versions — still useful output
          if (err && !stdout) {
            // If tree command is not found (ENOENT), fall back to JS implementation
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              try {
                text = generateTreeFallback(dirPath, { level: effectiveLevel, limit: effectiveLimit, ignore: allIgnore });
              } catch (fallbackErr: any) {
                const error = new Error(`tree failed and fallback also failed: ${fallbackErr.message}`);
                resolve({
                  data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
                  details: undefined,
                  error,
                });
                return;
              }
            } else {
              const error = new Error(`tree failed: ${stderr || err.message}`);
              resolve({
                data: new ToolResultMessage({ toolCallId, content: `Error: ${error.message}` }),
                details: undefined,
                error,
              });
              return;
            }
          } else {
            text = stdout || stderr;
          }

          const { content, truncated } = truncateTreeOutput(text);
          const details: TreeToolDetails = { command };

          resolve({
            data: new ToolResultMessage({ toolCallId, content }),
            details,
          });
        });

        signal?.addEventListener(
          'abort',
          () => {
            proc.kill();
          },
          { once: true },
        );
      });
    },
  };
}

/** Default tree tool using process.cwd() */
export const treeTool = createTreeTool(process.cwd());
