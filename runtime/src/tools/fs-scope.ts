/**
 * Filesystem scope and always-on secret blocklist used by fs tools when
 * an `AgentSecurityConfig` is supplied to their factory.
 *
 * - Secret blocklist: hardcoded, always active for fs tools regardless of
 *   security config. See runtime/docs/security-sandbox-design.md §4.1.
 * - Scope check: only applied when `security.fsScope` is set. Allowed read
 *   paths are checked for read-mode operations; allowed write paths for
 *   write-mode. The `ask-user` out-of-scope policy is wired up in step 4;
 *   step 3 only honors `'deny'`.
 */

import path from 'node:path';
import type { AgentSecurityConfig } from './security-types.js';

export const SECRET_PATTERNS: RegExp[] = [
  /\.env(\.|$)/i,
  /\.env\.(local|production|staging|development|test)/i,
  /credentials(\.json)?$/i,
  /secrets?\.(json|yaml|yml|toml)$/i,
  /\.aws\/credentials/,
  /\.aws\/config/,
  /\.ssh\/(id_rsa|id_ed25519|id_ecdsa|config|authorized_keys)/,
  /keystore/i,
  /\.pgpass$/,
  /netrc$/,
  /\.npmrc$/,
  /\.pypirc$/,
  /docker\/config\.json$/,
  /kubeconfig/i,
  /\.vault-token/,
  /\.gnupg\//,
  /private.*key/i,
  /.*\.pem$/,
  /.*\.p12$/,
  /.*\.pfx$/,
];

export function isSecretPath(absolutePath: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(absolutePath));
}

/**
 * Returns true if `absolutePath` is at or under any of `allowedRoots`.
 * `allowedRoots` are absolute paths; relative entries are skipped.
 */
export function isPathInScope(absolutePath: string, allowedRoots: string[]): boolean {
  const target = path.resolve(absolutePath);
  for (const root of allowedRoots) {
    if (!path.isAbsolute(root)) continue;
    const resolvedRoot = path.resolve(root);
    if (target === resolvedRoot) return true;
    const rel = path.relative(resolvedRoot, target);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return true;
  }
  return false;
}

export type FsAccessMode = 'read' | 'write';

export interface FsCheckOk {
  ok: true;
}
export interface FsCheckBlocked {
  ok: false;
  reason: 'secret-blocklist' | 'out-of-scope';
  message: string;
}
export type FsCheckResult = FsCheckOk | FsCheckBlocked;

/**
 * Run the always-on secret blocklist plus (when configured) the scope check.
 * Returns ok=true to proceed, or a structured block decision otherwise.
 *
 * `ask-user` policy is honored in step 4. For now any out-of-scope hit with
 * `outOfScopePolicy === 'ask-user'` is treated as deny — the path is wired,
 * the round-trip just isn't.
 */
export function enforceFsScope(params: {
  absolutePath: string;
  mode: FsAccessMode;
  security?: AgentSecurityConfig;
}): FsCheckResult {
  const { absolutePath, mode, security } = params;

  if (isSecretPath(absolutePath)) {
    return {
      ok: false,
      reason: 'secret-blocklist',
      message: `Access denied: '${absolutePath}' matches the hardcoded secret pattern blocklist.`,
    };
  }

  const scope = security?.fsScope;
  if (scope) {
    const allowed = mode === 'write' ? scope.allowedWritePaths : scope.allowedReadPaths;
    if (!isPathInScope(absolutePath, allowed)) {
      return {
        ok: false,
        reason: 'out-of-scope',
        message:
          `Access denied: '${absolutePath}' is outside the allowed ${mode} paths for this agent. ` +
          `Allowed roots: ${allowed.length === 0 ? '(none)' : allowed.join(', ')}.`,
      };
    }
  }

  return { ok: true };
}
