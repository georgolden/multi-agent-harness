/**
 * Sandbox runtime configuration types
 */

/**
 * Network mode for container
 * - "none": No network access (isolated)
 * - "slirp4netns": User-mode networking (allows outbound internet access)
 */
export type NetworkMode = 'none' | 'slirp4netns';

/**
 * Container pool configuration
 */
export interface PoolConfig {
  /** Minimum number of warm containers to keep running */
  min: number;
  /** Maximum number of containers allowed */
  max: number;
}

/**
 * Runtime configuration for a sandbox type
 */
export interface RuntimeConfig {
  /** Runtime name (e.g., "office", "pdf", "web-testing", "generic") */
  name: string;
  /** Docker/Podman image name with tag */
  image: string;
  /** Container pool settings */
  pool: PoolConfig;
  /** Network mode for containers */
  network: NetworkMode;
  /** Timeout in milliseconds for each executeCommands call; kills stuck commands */
  executionTimeout: number;
  /** Allow multiple sessions and executeCommands per container (false for LibreOffice due to locking) */
  parallelExecutions: boolean;
  /** Maximum parallel executeCommands batches across all sessions for this runtime */
  maxParallelExecutions: number;
}

/**
 * Mapping of skill names to runtime types
 */
export type SkillRuntimesMap = Record<string, string | null>;

/**
 * Runtime type names
 */
export type RuntimeType = 'office' | 'pdf' | 'web-testing' | 'generic';
