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
 * Sandbox mode:
 * - "shared": one long-lived container per runtime; sessions live as subfolders.
 *             `limit` caps concurrent command executions.
 * - "exclusive": one container per session, destroyed on cleanup.
 *                `limit` caps live containers (queued when full).
 */
export type SandboxMode = 'shared' | 'exclusive';

/**
 * Runtime configuration for a sandbox type
 */
export interface RuntimeConfig {
  /** Runtime name (e.g., "office", "pdf", "web-testing", "generic") */
  name: string;
  /** Docker/Podman image name with tag */
  image: string;
  /** Sandbox mode */
  mode: SandboxMode;
  /**
   * shared: max concurrent command executions across all sessions
   * exclusive: max live containers
   */
  limit: number;
  /** Network mode for containers */
  network: NetworkMode;
  /** Timeout in milliseconds per executeSkillCommands batch */
  executionTimeout: number;
}

/** Mapping of skill names to runtime types */
export type SkillRuntimesMap = Record<string, string | null>;

/** Per-context bind mount baked into an exclusive container's spawn argv */
export interface SkillContextMount {
  /** Host absolute path */
  hostPath: string;
  /** Basename inside the container (deduped) */
  name: string;
  type: 'file' | 'folder';
}
