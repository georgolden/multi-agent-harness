import type { AgentTool } from '../types.js';
import { type Static, Type } from '@sinclair/typebox';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { resolveToCwd } from './path-utils.js';
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
 * Runs the `tree` command on a directory and returns the raw output string.
 * Merges DEFAULT_TREE_IGNORE with any extra patterns passed in `ignore`.
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
        reject(new Error(`tree failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout || stderr);
    });

    signal?.addEventListener('abort', () => proc.kill(), { once: true });
  });
}

export function createTreeTool(cwd: string, options?: TreeToolOptions): AgentTool<typeof treeSchema> {
  const baseIgnore = options?.defaultIgnore ?? DEFAULT_TREE_IGNORE;

  return {
    name: 'tree',
    label: 'tree',
    description: `Display directory tree structure. Uses the system \`tree\` command. Defaults to depth ${DEFAULT_LEVEL} and ignores common bloat folders (node_modules, target, __pycache__, dist, .git, venv, vendor, etc.). Output capped at ${DEFAULT_FILE_LIMIT} files per directory.`,
    parameters: treeSchema,
    execute: async (
      _app: App,
      { path, level, ignore, limit }: TreeToolInput,
      { signal }: { toolCallId: string; signal?: AbortSignal },
    ) => {
      const dirPath = resolveToCwd(path || '.', cwd);

      if (!existsSync(dirPath)) {
        throw new Error(`Path not found: ${dirPath}`);
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
          // tree exits non-zero when filelimit is hit in some versions — still useful output
          if (err && !stdout) {
            reject(new Error(`tree failed: ${stderr || err.message}`));
            return;
          }
          const text = stdout || stderr;
          resolve({
            content: [{ type: 'text', text }],
            details: { command } satisfies TreeToolDetails,
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
