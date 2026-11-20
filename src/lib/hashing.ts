import { createHash } from 'node:crypto';

/**
 * Deterministic SHA-256 of a UTF-8 string, lowercase hex (64 characters).
 * Same input on any platform and in any run gives the same digest — every
 * content hash and run id in this repo is taken over this function.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * JSON with object keys sorted recursively: the canonical form every hash in
 * this repo is computed over.
 *
 * - Arrays keep their order (order is data).
 * - Object keys are sorted by code unit, never by locale, so the output is
 *   identical on every machine.
 * - `undefined` and non-finite numbers render as `null`, exactly as
 *   `JSON.stringify` renders them; a `Date` renders as a quoted ISO string and
 *   a `bigint` as a quoted decimal, so neither throws.
 * - The input must be acyclic and JSON-shaped; other artifacts are out of
 *   scope for the data contracts.
 */
export function stableStringify(value: unknown): string {
  return serialise(value);
}

/** Content hash: `sha256Hex(stableStringify(value))`. */
export function contentHash(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

function serialise(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((item) => serialise(item)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const body = entries
      .map(([key, item]) => `${JSON.stringify(key)}:${serialise(item)}`)
      .join(',');
    return `{${body}}`;
  }
  // Functions and symbols never appear in the JSON-shaped data artifacts.
  return 'null';
}
