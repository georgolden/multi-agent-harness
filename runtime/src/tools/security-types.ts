/**
 * Per-agent security and sandbox configuration types.
 * See runtime/docs/security-sandbox-implementation-plan.md §4.2-4.3.
 *
 * These travel through AgenticLoopSchema, AgentSession and FlowSession so
 * a crashed runtime can rebuild the agent with identical restrictions.
 */

export interface AgentSecurityConfig {
  // For built-in agents only. Schema agents derive their scope from
  // contextPaths automatically (read+write, no read-only mode yet); the
  // runtime resolves both forms into the same internal structure.
  fsScope?: {
    allowedReadPaths: string[];
    allowedWritePaths: string[];
    outOfScopePolicy: 'deny' | 'ask-user';
  };

  // Decoy tools registered alongside real tools. Triggering one stops the
  // agent and fires an alert.
  honeypots?: string[];

  // Optional injection scanning. For schema agents this is part of their
  // configuration; for built-in agents this is set in code.
  injectionScan?: {
    fastHeuristic: boolean;
    deepScanAtBoundary: boolean;
  };
}

export interface AgentSandboxConfig {
  // Profile name — must match a directory under runtime/src/sandbox/runtimes/.
  rootfsProfile: string;

  // Internet access on/off. Defaults to false.
  network?: boolean;

  // Optional resource caps. Profile config.json defaults apply when omitted.
  cpuSeconds?: number;
  memoryMb?: number;

  // Tools that are forced to run inside the sandbox. Anything not listed runs
  // host-side under the normal fs-scope and secret-blocklist guards.
  sandboxedTools?: string[];
}
