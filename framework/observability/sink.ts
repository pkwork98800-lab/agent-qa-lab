/**
 * Trace sink — framework/observability (agent 7).
 * ---------------------------------------------------------------------------
 * Owned paths: framework/observability/** only.
 *
 * Thin entry point the runner calls: `emitTraces(traces)`. Delegates to the
 * Langfuse client, which runs in fixture mode (default, no key — appends NDJSON
 * to `runs/latest/traces.ndjson` and prints a visible warning naming the fixture
 * sink) or live mode (real Langfuse ingestion when keys are configured).
 *
 * Re-exported here so `scripts/run-eval.ts` can import a single stable symbol
 * from `framework/observability/sink.ts` while the client lives in
 * `langfuse-client.ts`.
 */

import { LangfuseClient, fixtureWarning, FIXTURE_SINK } from './langfuse-client.ts';
import type { Env } from '../../src/lib/env.ts';
import type { Trace } from '../../src/contracts/types.ts';

let client: LangfuseClient | undefined;

/** Get or create the client for the current process environment. */
export function getClient(env: Env): LangfuseClient {
  if (client === undefined) client = new LangfuseClient(env);
  return client;
}

/** Emit one or more traces. Fixture mode (default) appends to the local NDJSON
 *  sink and prints the fixture warning once; live mode POSTs to Langfuse.
 *  `logicalClockIso` is the runner's fixed logical clock — never `Date.now()`
 *  inside this module. */
export async function emitTraces(
  traces: Trace[],
  env: Env,
  logicalClockIso: string,
): Promise<void> {
  await getClient(env).emitTraces(traces, logicalClockIso);
}

/** Read traces back (fixture mode reads the local NDJSON sink). */
export async function fetchTraces(env: Env, logicalClockIso?: string): Promise<Trace[]> {
  return getClient(env).fetchTraces(logicalClockIso);
}

export { fixtureWarning, FIXTURE_SINK };
