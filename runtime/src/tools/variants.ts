/**
 * Variant factories for security/sandbox-aware tool resolution.
 *
 * Scaffolding only (step 1): every factory currently returns the input tool
 * unchanged. Real behavior (fs scope, secret blocklist, sandbox dispatch,
 * honeypot alert) is filled in later steps without changing call sites.
 *
 * See runtime/docs/security-sandbox-implementation-plan.md §4.5.
 */

import type { AgentTool } from '../types.js';

export interface AgentSecurityConfig {
  fsScope?: {
    allowedReadPaths: string[];
    allowedWritePaths: string[];
    outOfScopePolicy: 'deny' | 'ask-user';
  };
  honeypots?: string[];
  injectionScan?: {
    fastHeuristic: boolean;
    deepScanAtBoundary: boolean;
  };
}

export interface AgentSandboxConfig {
  rootfsProfile: string;
  network?: boolean;
  cpuSeconds?: number;
  memoryMb?: number;
  sandboxedTools?: string[];
}

export function makeStandardTool(tool: AgentTool): AgentTool {
  return tool;
}

export function makeScopedFsTool(
  tool: AgentTool,
  _security: AgentSecurityConfig,
): AgentTool {
  return tool;
}

export function makeSandboxedTool(
  tool: AgentTool,
  _sandbox: AgentSandboxConfig,
): AgentTool {
  return tool;
}

export function makeHoneypotTool(tool: AgentTool): AgentTool {
  return tool;
}
