import * as os from 'node:os';
import { isAbsolute, resolve as resolvePath } from 'node:path';

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

function normalizeUnicodeSpaces(str: string): string {
  return str.replace(UNICODE_SPACES, ' ');
}

function normalizeAtPrefix(filePath: string): string {
  return filePath.startsWith('@') ? filePath.slice(1) : filePath;
}

export function expandPath(filePath: string): string {
  const normalized = normalizeUnicodeSpaces(normalizeAtPrefix(filePath));
  if (normalized === '~') {
    return os.homedir();
  }
  if (normalized.startsWith('~/')) {
    return os.homedir() + normalized.slice(1);
  }
  return normalized;
}

/**
 * Resolve a path relative to the given cwd.
 * Handles ~ expansion and absolute paths.
 * Does NOT perform fuzzy matching or variant lookups — the path must be exact.
 */
export function resolveToCwd(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  if (isAbsolute(expanded)) {
    return expanded;
  }
  return resolvePath(cwd, expanded);
}

/**
 * Resolve a path for reading. Same as resolveToCwd — strict resolution, no fuzzy matching.
 */
export function resolveReadPath(filePath: string, cwd: string): string {
  return resolveToCwd(filePath, cwd);
}
