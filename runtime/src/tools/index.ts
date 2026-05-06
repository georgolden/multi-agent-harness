export {
  type BashOperations,
  type BashSpawnContext,
  type BashSpawnHook,
  type BashToolDetails,
  type BashToolInput,
  type BashToolOptions,
  bashTool,
  createBashTool,
} from './bash.js';
export {
  createEditTool,
  type EditOperations,
  type EditToolDetails,
  type EditToolInput,
  type EditToolOptions,
  editTool,
} from './edit.js';
export {
  createFindTool,
  type FindOperations,
  type FindToolDetails,
  type FindToolInput,
  type FindToolOptions,
  findTool,
} from './find.js';
export {
  createGrepTool,
  type GrepOperations,
  type GrepToolDetails,
  type GrepToolInput,
  type GrepToolOptions,
  grepTool,
} from './grep.js';
export {
  createLsTool,
  type LsOperations,
  type LsToolDetails,
  type LsToolInput,
  type LsToolOptions,
  lsTool,
} from './ls.js';
export {
  createTreeTool,
  DEFAULT_TREE_IGNORE,
  runTreeCommand,
  type RunTreeOptions,
  type TreeToolDetails,
  type TreeToolInput,
  type TreeToolOptions,
  treeTool,
} from './tree.js';
export {
  createReadTool,
  type ReadOperations,
  type ReadToolDetails,
  type ReadToolInput,
  type ReadToolOptions,
  readTool,
} from './read.js';
export {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationOptions,
  type TruncationResult,
  truncateHead,
  truncateLine,
  truncateTail,
} from './truncate.js';
export {
  createWriteTool,
  type WriteOperations,
  type WriteToolInput,
  type WriteToolOptions,
  writeTool,
} from './write.js';
export {
  createRunAgentTool,
  type RunAgentInput,
  type RunAgentDetails,
  runAgentSchema,
  runAgentTool,
} from './runAgent.js';
export {
  createWriteTempFileTool,
  type WriteTempFileInput,
  type WriteTempFileDetails,
  writeTempFileSchema,
  writeTempFileTool,
} from './writeTempFile.js';
export {
  createSpawnAgentTool,
  type SpawnAgentInput,
  type SpawnAgentDetails,
  spawnAgentSchema,
  spawnAgentTool,
} from './spawnAgent.js';
export { createSkillTool, type SkillToolInput } from './skill.js';
export {
  createWebFetchTool,
  type WebFetchToolInput,
  webFetchTool,
} from './webfetch.js';
export {
  createWebSearchTool,
  type WebSearchToolInput,
  webSearchTool,
} from './websearch.js';

import type { AgentTool } from '../types.js';
import { type BashToolOptions, bashTool, createBashTool } from './bash.js';
import { createEditTool, editTool } from './edit.js';
import { createFindTool, findTool } from './find.js';
import { createGrepTool, grepTool } from './grep.js';
import { createLsTool, lsTool } from './ls.js';
import { createReadTool, type ReadToolOptions, readTool } from './read.js';
import { createTreeTool, treeTool } from './tree.js';
import { createWriteTool, writeTool } from './write.js';
import { createRunAgentTool } from './runAgent.js';
import { createWriteTempFileTool } from './writeTempFile.js';
import { createSpawnAgentTool } from './spawnAgent.js';
import { createSkillTool } from './skill.js';
import { createWebFetchTool } from './webfetch.js';
import { createWebSearchTool } from './websearch.js';
import { RuntimeUser } from '../services/userService/index.js';
import { Session } from '../services/sessionService/session.js';
import type { Skills } from '../skills/index.js';
import type { SandboxService } from '../services/sandbox/index.js';
import type { AgentSecurityConfig, AgentSandboxConfig } from './security-types.js';

/** Tool type (AgentTool from pi-ai) */
export type Tool = AgentTool<any>;

export type ToolCallContext = {
  user: RuntimeUser;
  parent?: Session;
  session: Session;
};

// Tool schema - matches real tool format
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON schema for parameters
}

// Tool execution log
export interface ToolLog {
  callId: string;
  name: string;
  input: string;
  output: string;
  startedAt: Date;
  endedAt: Date;
  status: 'success' | 'error';
}

// Default tools for full access mode (using process.cwd())
export const codingTools: Tool[] = [readTool, bashTool, editTool, writeTool];

// Read-only tools for exploration without modification (using process.cwd())
export const readOnlyTools: Tool[] = [readTool, grepTool, findTool, lsTool, treeTool];

// All available tools (using process.cwd())
export const allTools = {
  read: readTool,
  bash: bashTool,
  edit: editTool,
  write: writeTool,
  grep: grepTool,
  find: findTool,
  ls: lsTool,
  tree: treeTool,
};

export type ToolName = keyof typeof allTools;

export interface ToolsOptions {
  /** Options for the read tool */
  read?: ReadToolOptions;
  /** Options for the bash tool */
  bash?: BashToolOptions;
}

/**
 * Create coding tools configured for a specific working directory.
 */
export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
  return [
    createReadTool(cwd, options?.read),
    createBashTool(cwd, options?.bash),
    createEditTool(cwd),
    createWriteTool(cwd),
  ];
}

/**
 * Create read-only tools configured for a specific working directory.
 */
export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
  return [
    createReadTool(cwd, options?.read),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
    createTreeTool(cwd),
  ];
}

export interface ToolsSkillOptions {
  skills: Skills;
  sandbox: SandboxService;
  session: Session;
}

export interface ResolveToolOptions {
  /** Per-agent security config — applied to fs tools that support it. */
  security?: AgentSecurityConfig;
  /** Per-agent sandbox config — reserved for the sandbox step. Currently ignored. */
  sandbox?: AgentSandboxConfig;
}

export class Tools {
  toolsMap: Record<string, Tool>;
  readonlyToolsMap: Record<string, Tool>;
  codingToolsMap: Record<string, Tool>;
  private _cwd: string;
  private _options?: ToolsOptions;

  constructor(cwd: string, options?: ToolsOptions, skillOptions?: ToolsSkillOptions) {
    this._cwd = cwd;
    this._options = options;
    void skillOptions;
    this.readonlyToolsMap = {
      read: createReadTool(cwd, options?.read),
      grep: createGrepTool(cwd),
      ls: createLsTool(cwd),
      find: createFindTool(cwd),
      tree: createTreeTool(cwd),
    };

    this.codingToolsMap = {
      read: createReadTool(cwd, options?.read),
      bash: createBashTool(cwd, options?.bash),
      edit: createEditTool(cwd),
      write: createWriteTool(cwd),
    };

    this.toolsMap = {
      ...this.readonlyToolsMap,
      ...this.codingToolsMap,
      runAgent: createRunAgentTool(),
      writeTempFile: createWriteTempFileTool(),
      spawnAgent: createSpawnAgentTool(),
      skill: createSkillTool(),
      webfetch: createWebFetchTool(),
      websearch: createWebSearchTool(),
    };
  }

  getReadOnlyTools(): Tool[] {
    return Object.values(this.readonlyToolsMap);
  }

  getCodingTools(): Tool[] {
    return Object.values(this.codingToolsMap);
  }

  getAllTools(): Tool[] {
    return Object.values(this.toolsMap);
  }

  /**
   * Returns Tool[] for the given tool names, skipping unknown names.
   */
  getSlice(names: string[]): Tool[] {
    return names.filter((name) => name in this.toolsMap).map((name) => this.toolsMap[name]);
  }

  /**
   * Resolve a single tool by name with per-agent security/sandbox config.
   * Re-runs the underlying factory for fs tools so the supplied
   * `security` is baked into the returned tool's `execute`.
   *
   * Behavior is fully determined by `(name, opts)` — there is no hidden
   * runtime state, so a crashed runtime can rebuild identical tools from
   * the persisted (toolName, securityConfig, sandboxConfig) snapshot.
   */
  resolveByName(name: string, opts?: ResolveToolOptions): Tool | undefined {
    const security = opts?.security;
    const cwd = this._cwd;
    switch (name) {
      case 'read':
        return createReadTool(cwd, { ...this._options?.read, security });
      case 'write':
        return createWriteTool(cwd, { security });
      case 'edit':
        return createEditTool(cwd, { security });
      case 'find':
        return createFindTool(cwd, { security });
      case 'grep':
        return createGrepTool(cwd, { security });
      case 'ls':
        return createLsTool(cwd, { security });
      case 'tree':
        return createTreeTool(cwd, { security });
      default:
        return this.toolsMap[name];
    }
  }

  /**
   * Resolve a slice of tools by name with per-agent security/sandbox config,
   * skipping unknown names.
   */
  resolveSlice(names: string[], opts?: ResolveToolOptions): Tool[] {
    const out: Tool[] = [];
    for (const name of names) {
      const tool = this.resolveByName(name, opts);
      if (tool) out.push(tool);
    }
    return out;
  }

  /**
   * Returns a formatted string listing all built-in tool names and descriptions.
   * Used to inject available tools into system prompts.
   */
  getBuiltinToolDescriptions(): string {
    return Object.entries(this.toolsMap)
      .map(([name, tool]) => `- ${name}: ${tool.description ?? ''}`)
      .join('\n');
  }
}
