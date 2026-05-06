/**
 * Heuristic prompt-injection detection.
 * See runtime/docs/security-sandbox-design.md §6.1 and implementation plan §4.7.
 */

export const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |the )?(previous|prior|above) (instructions?|prompts?|rules?)/i,
  /disregard (all |the )?(previous|prior|above) (instructions?|prompts?|rules?)/i,
  /system\s*[:\-]\s*you are/i,
  /you are now (a |an )?[a-z]+/i,
  /\bnew (instructions?|task|role|persona)\b/i,
  /\bact as (a |an )?[a-z]+/i,
  /\bforget (everything|all|prior)\b/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\bBEGIN (SYSTEM|INSTRUCTION) PROMPT\b/i,
];

// Patterns that indicate emoji abuse: ZWJ sequences (e.g. 👨‍💻), variation-selector
// chains, and dense clusters. Normal agent output uses at most one emoji per
// sentence; everything beyond that is treated as a signal.
export const EMOJI_SEQUENCE_PATTERN =
  /(\p{Emoji_Presentation}\p{Emoji_Modifier}?(‍\p{Emoji_Presentation}\p{Emoji_Modifier}?)+)/u;
export const EMOJI_CLUSTER_PATTERN =
  /(\p{Emoji_Presentation}[\p{Emoji_Presentation}️⃣‍]{2,})/u;

export interface QuickScanResult {
  flagged: boolean;
  matches: string[];
}

export function quickScan(text: string): QuickScanResult {
  const matches: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    const m = text.match(pattern);
    if (m) matches.push(m[0]);
  }
  const seq = text.match(EMOJI_SEQUENCE_PATTERN);
  if (seq) matches.push(seq[0]);
  const cluster = text.match(EMOJI_CLUSTER_PATTERN);
  if (cluster) matches.push(cluster[0]);
  return { flagged: matches.length > 0, matches };
}
