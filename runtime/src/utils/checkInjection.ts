/**
 * Boundary-check utilities. Agent-scope tools (submit_result, runAgent,
 * spawnAgent) call these explicitly when their agent's config opts in.
 *
 * Sanitization pipeline per runtime/docs/security-sandbox-design.md §7:
 * normalize Unicode, strip control chars / private-use area / zero-width
 * chars, normalize unusual whitespace, collapse emoji sequences and clusters
 * to a single base emoji, and enforce at most one emoji per sentence.
 */

import {
  EMOJI_CLUSTER_PATTERN,
  EMOJI_SEQUENCE_PATTERN,
  quickScan,
  type QuickScanResult,
} from './injection.js';

export function checkInjection(text: string): QuickScanResult {
  return quickScan(text);
}

const EMOJI_SEQUENCE_GLOBAL = new RegExp(EMOJI_SEQUENCE_PATTERN.source, 'gu');
const EMOJI_CLUSTER_GLOBAL = new RegExp(EMOJI_CLUSTER_PATTERN.source, 'gu');
const SINGLE_EMOJI_GLOBAL = /\p{Emoji_Presentation}\p{Emoji_Modifier}?/gu;
const SINGLE_EMOJI = /\p{Emoji_Presentation}/u;

function firstBaseEmoji(input: string): string {
  for (const c of input) {
    if (SINGLE_EMOJI.test(c)) return c;
  }
  return '';
}

export function sanitizeBoundaryString(input: string): string {
  return input
    .normalize('NFC')
    // C0/C1 control characters, except tab/newline/carriage return
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    // Basic Multilingual Plane private-use area
    .replace(/[-]/g, '')
    // Supplementary private-use planes (high+low surrogate ranges)
    .replace(/[\uDB80-\uDBFF][\uDC00-\uDFFF]/g, '')
    // Zero-width / invisible formatting characters and soft hyphen
    .replace(/[​-‍⁠﻿­]/g, '')
    // Excessive stacked combining marks (keep up to 2 standard diacritics)
    .replace(/[̀-ͯ]{3,}/g, '')
    // Unusual whitespace variants normalized to a regular space
    .replace(/[   -   　]/g, ' ')
    // Collapse ZWJ sequences and emoji clusters down to their first base emoji
    .replace(EMOJI_SEQUENCE_GLOBAL, firstBaseEmoji)
    .replace(EMOJI_CLUSTER_GLOBAL, firstBaseEmoji)
    // Enforce one emoji per sentence: split on sentence boundaries, keep
    // first emoji in each segment, drop the rest.
    .split(/([.!?\n])/)
    .map((seg) => {
      let kept = false;
      return seg.replace(SINGLE_EMOJI_GLOBAL, (m) => {
        if (kept) return '';
        kept = true;
        return m;
      });
    })
    .join('')
    .trim();
}
