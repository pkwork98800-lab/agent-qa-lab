/**
 * Pure-TypeScript text similarity (no dependencies).
 *
 * similarity(a, b) = 0.6 * jaccard(tokenSet(a), tokenSet(b))
 *                  + 0.4 * levenshteinRatio(a, b)
 *
 * computed over `title + signature`. Default threshold 0.72: high enough that
 * genuinely distinct failures (different scenario or error class) almost never
 * collide, low enough that near-duplicate tickets (same root cause, reworded
 * title) still merge. Below ~0.6 the noise rate rises; above ~0.85 real
 * duplicates with slightly different wording split apart.
 */
export const DEDUPE_THRESHOLD = 0.72;

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'he',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'was',
  'were',
  'will',
  'with',
]);

const WORD_RE = /[a-z0-9]+/g;

/** Lowercase word tokens minus stopwords. */
export function tokenSet(s: string): Set<string> {
  const tokens = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = WORD_RE.exec(s.toLowerCase())) !== null) {
    const word = match[0];
    if (!STOPWORDS.has(word)) tokens.add(word);
  }
  return tokens;
}

/** Jaccard index of two token sets: intersection / union. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev: number[] = [];
  let curr: number[] = [];
  for (let j = 0; j <= n; j++) {
    prev[j] = j;
    curr[j] = 0;
  }
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Normalised Levenshtein similarity: 1 - distance / max length. */
export function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Combined similarity over title + signature. */
export function similarity(a: string, b: string): number {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  return 0.6 * jaccard(ta, tb) + 0.4 * levenshteinRatio(a, b);
}

/** True when two strings are near-duplicates at the dedupe threshold. */
export function isNearDuplicate(a: string, b: string): boolean {
  return similarity(a, b) >= DEDUPE_THRESHOLD;
}
