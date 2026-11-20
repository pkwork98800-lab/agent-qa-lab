/**
 * Langfuse client — framework/observability (agent 7).
 * ---------------------------------------------------------------------------
 * Owned paths: framework/observability/** only.
 *
 * Two modes, gated on `LANGFUSE_SECRET_KEY` (src/lib/env.ts):
 *
 *  * Fixture mode (default, no key): no network, prints a visible warning
 *    naming the fixture sink. `emitTraces` appends NDJSON to
 *    `runs/latest/traces.ndjson`; `fetchTraces` reads it back.
 *  * Live mode (key present): real Langfuse Cloud / self-managed ingestion
 *    via batched `POST /api/public/ingestion` with basic auth `public:secret`,
 *    events in Langfuse's trace-create / span-create shape. Reads via
 *    `GET /api/public/traces`.
 *
 * The runner passes a fixed logical clock (an ISO timestamp string) — this
 * module never calls `Date.now()` or `new Date()` itself, so offline runs
 * regenerate byte-identically and wall-clock never leaks into artefacts.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from '../../src/lib/logger.ts';
import type { Env } from '../../src/lib/env.ts';
import type { Trace, TraceSpan } from '../../src/contracts/types.ts';

const log = createLogger('observability/langfuse');

/** Name of the fixture sink the warning text references. */
export const FIXTURE_SINK = 'runs/latest/traces.ndjson';

/** Fixture-mode warning, printed once per process by emitTraces. It names the
 *  fixture sink so operators can see exactly where traces land offline. */
export function fixtureWarning(): string {
  return (
    'WARN observability/langfuse: no LANGFUSE_SECRET_KEY configured — ' +
    'running in fixture mode. Traces are appended to ' +
    FIXTURE_SINK +
    ' instead of being sent to Langfuse. Set LANGFUSE_PUBLIC_KEY and ' +
    'LANGFUSE_SECRET_KEY (and optionally LANGFUSE_HOST) to enable live ' +
    'ingestion.'
  );
}

/** Langfuse trace-create event shape, per the public ingestion API. */
interface LangfuseTraceCreate {
  id: string;
  name: string;
  timestamp: string;
  sessionId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

/** Langfuse span-create event shape. */
interface LangfuseSpanCreate {
  id: string;
  traceId: string;
  name: string;
  startTime: string;
  endTime?: string;
  metadata?: Record<string, unknown>;
  level?: string;
  statusMessage?: string;
  version?: string;
  input?: unknown;
  output?: unknown;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
    unit?: string;
  };
  parentSpanId?: string;
}

/** A single ingestion batch: one trace event plus one span event per span. */
interface IngestionBatch {
  data: Array<{ type: string; payload: LangfuseTraceCreate | LangfuseSpanCreate }>;
}

export class LangfuseClient {
  private readonly env: Env;
  private hasWarned = false;

  constructor(env: Env) {
    this.env = env;
  }

  /** True when live-mode keys are configured. */
  get isLive(): boolean {
    return this.env.langfusePublicKey !== undefined && this.env.langfuseSecretKey !== undefined;
  }

  /** Emit one or more traces. Fixture mode appends to the local NDJSON sink
   *  (and prints the fixture warning once); live mode POSTs to Langfuse. */
  async emitTraces(traces: Trace[], logicalClockIso: string): Promise<void> {
    if (!this.isLive) {
      if (!this.hasWarned) {
        console.warn(fixtureWarning());
        this.hasWarned = true;
      }
      for (const trace of traces) appendTraceToFixture(trace);
      log.info('traces appended to fixture sink', {
        count: traces.length,
        sink: FIXTURE_SINK,
      });
      return;
    }

    const host = this.env.langfuseHost;
    const publicKey = this.env.langfusePublicKey;
    const secretKey = this.env.langfuseSecretKey;
    if (publicKey === undefined || secretKey === undefined) {
      throw new Error('Langfuse live mode requires both LANGFUSE keys.');
    }
    const auth = Buffer.from(`${publicKey}:${secretKey}`).toString('base64');

    const batch: IngestionBatch = { data: [] };
    for (const trace of traces) {
      batch.data.push({
        type: 'trace-create',
        payload: {
          id: trace.traceId,
          name: trace.scenarioId,
          timestamp: logicalClockIso,
          metadata: { scenarioId: trace.scenarioId },
        },
      });
      for (const span of trace.spans) {
        batch.data.push({
          type: 'span-create',
          payload: toLangfuseSpan(trace, span, logicalClockIso),
        });
      }
    }

    const response = await fetch(`${host}/api/public/ingestion`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Langfuse ingestion failed (HTTP ${String(response.status)}): ${body.slice(0, 500)}`,
      );
    }
    log.info('traces ingested into Langfuse', { count: traces.length, host });
  }

  /** Read traces. Live mode: GET /api/public/traces. Fixture mode: the local
   *  NDJSON sink. `logicalClockIso` is only used by live pagination params. */
  async fetchTraces(logicalClockIso?: string): Promise<Trace[]> {
    if (!this.isLive) {
      const path = fixturePath();
      if (!existsSync(path)) return [];
      const text = readFileSync(path, 'utf8');
      const traces: Trace[] = [];
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          traces.push(JSON.parse(trimmed) as Trace);
        } catch {
          // skip malformed lines rather than aborting a read-back audit.
        }
      }
      return traces;
    }

    const host = this.env.langfuseHost;
    const publicKey = this.env.langfusePublicKey;
    const secretKey = this.env.langfuseSecretKey;
    if (publicKey === undefined || secretKey === undefined) {
      throw new Error('Langfuse live mode requires both LANGFUSE keys.');
    }
    const auth = Buffer.from(`${publicKey}:${secretKey}`).toString('base64');
    const url = new URL(`${host}/api/public/traces`);
    if (logicalClockIso) url.searchParams.set('fromTimestamp', logicalClockIso);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Langfuse fetch failed (HTTP ${String(response.status)}): ${body.slice(0, 500)}`,
      );
    }
    const payload = (await response.json()) as { data?: Trace[] };
    return payload.data ?? [];
  }
}

function fixturePath(): string {
  return `${process.cwd()}/${FIXTURE_SINK}`;
}

function appendTraceToFixture(trace: Trace): void {
  const path = fixturePath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(trace)}\n`, 'utf8');
}

function toLangfuseSpan(
  trace: Trace,
  span: TraceSpan,
  logicalClockIso: string,
): LangfuseSpanCreate {
  return {
    id: span.id,
    traceId: trace.traceId,
    name: span.name,
    startTime: spanStartIso(span.startMs, logicalClockIso),
    endTime: spanEndIso(span.endMs, logicalClockIso),
    parentSpanId: span.parentId === null ? undefined : span.parentId,
    metadata: { scenarioId: span.scenarioId, persona: span.persona, kind: span.kind },
    level: 'DEFAULT',
    input: span.input === undefined ? undefined : span.input,
    output: span.output === undefined ? undefined : span.output,
    version: span.promptVersion,
    usage: span.usage
      ? {
          input: span.usage.promptTokens,
          output: span.usage.completionTokens,
          total: span.usage.promptTokens + span.usage.completionTokens,
          unit: 'tokens',
        }
      : undefined,
  };
}

/** Convert a monotonic tick offset into an ISO timestamp anchored to the
 *  logical clock passed in by the runner. Never reads wall clock here. */
function spanStartIso(startMs: number, logicalClockIso: string): string {
  return offsetIso(logicalClockIso, startMs);
}

function spanEndIso(endMs: number, logicalClockIso: string): string {
  return offsetIso(logicalClockIso, endMs);
}

function offsetIso(baseIso: string, offsetMs: number): string {
  const base = new Date(baseIso);
  if (Number.isNaN(base.getTime())) return baseIso;
  return new Date(base.getTime() + offsetMs).toISOString();
}
