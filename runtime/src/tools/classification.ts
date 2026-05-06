/**
 * Tool classification used by the security/sandbox variant resolver and audit log.
 * See runtime/docs/security-sandbox-implementation-plan.md §4.1.
 *
 * Not wired into runtime behavior yet — added in step 1 (scaffolding).
 */

export type ToolCategory =
  | 'execution'
  | 'fs-write'
  | 'fs-read'
  | 'agent-control'
  | 'session'
  | 'toolkit';

export type Criticality = 'critical' | 'high' | 'medium' | 'low';

export interface ToolClassification {
  category: ToolCategory;
  criticality: Criticality;
}

export const TOOL_CLASSIFICATION: Record<string, ToolClassification> = {
  bash: { category: 'execution', criticality: 'critical' },
  write: { category: 'fs-write', criticality: 'high' },
  edit: { category: 'fs-write', criticality: 'high' },
  'edit-diff': { category: 'fs-write', criticality: 'high' },
  read: { category: 'fs-read', criticality: 'high' },
  find: { category: 'fs-read', criticality: 'high' },
  grep: { category: 'fs-read', criticality: 'high' },
  ls: { category: 'fs-read', criticality: 'medium' },
  tree: { category: 'fs-read', criticality: 'medium' },
  spawnAgent: { category: 'agent-control', criticality: 'high' },
  runAgent: { category: 'agent-control', criticality: 'high' },
  skill: { category: 'session', criticality: 'low' },
  writeTempFile: { category: 'session', criticality: 'low' },
};

export function classifyTool(name: string): ToolClassification | undefined {
  return TOOL_CLASSIFICATION[name];
}
