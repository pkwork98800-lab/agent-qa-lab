import { sha256Hex } from './hashing.ts';

/**
 * Deterministic run id: `offline-` plus 10 hex characters of
 * `sha256(sorted scenario ids joined with commas + code version)`.
 *
 * The same scenario set and code version always produce the same id, which is
 * what makes an offline run byte-reproducible. `override` (the RUN_ID env var,
 * see src/lib/env.ts) wins when set to a non-empty value.
 */
export function computeRunId(
  scenarioIds: string[],
  codeVersion: string,
  override?: string,
): string {
  if (override !== undefined && override.trim().length > 0) return override;
  const sorted = [...scenarioIds].sort();
  const hash = sha256Hex(`${sorted.join(',')}|${codeVersion}`);
  return `offline-${hash.slice(0, 10)}`;
}
