import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Read and parse a JSON file. Key order is preserved exactly as written —
 * report artefacts are read by tools (and humans) that care about it.
 */
// The caller names the contract type it expects — that generic is the whole
// point of a typed JSON read, so the single-use type parameter is the API.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed read contract (agent brief §10).
export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/**
 * Pretty-write JSON: two-space indent, LF, one trailing newline, parent
 * directories created. Key order is the input object's own order (never
 * sorted): key order is meaningful in report output. Stable given the same
 * input object.
 */
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Write one JSON value per line (no trailing blank line beyond the final LF). */
export function writeNdjson(path: string, values: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = values.map((value) => JSON.stringify(value)).join('\n');
  writeFileSync(path, values.length === 0 ? '' : `${body}\n`, 'utf8');
}

/** Append one JSON value as a single line, creating parent directories. */
export function appendNdjson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

/** True when the path exists (files and directories alike). */
export function fileExists(path: string): boolean {
  return existsSync(path);
}
