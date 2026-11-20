# Agent 7 — Observability / trace-compliance auditor

You own: `framework/observability/**`.
You do NOT own: `package.json`, `src/contracts/**` (read-only), `src/lib/**`,
`apps/**`, `scripts/**`.

## Context

Read `docs/BUILD-CONTRACT.md` (§5 trace shapes, §6 span rules, §7 module API,
§8–§9) and `src/contracts/types.ts` (`TraceSpan`, `Trace`, `TraceExpectation`).
This module implements the JD line _"a step that is not logged is a bug"_ and
the Langfuse story: pull/inspect the trace of every run and assert its shape,
budgets and hygiene.

## Deliverables

### `framework/observability/shapes.ts`

The trace-shape catalogue from BUILD-CONTRACT §5 (read-lookup, update-record,
create-record, email-send, multi-step, refusal) as data: `requiredSpans`
(ordered subsequence), `forbiddenSpans`, default budgets (`maxLatencyMs`,
`maxCostUsd`). Plus `shapeForCategory(category)` mapping scenario category →
shapeId.

### `framework/observability/sink.ts` + `langfuse-client.ts`

- `emitTraces(traces: Trace[]): Promise<void>` — the single entry the runner
  calls. Default (no `LANGFUSE_SECRET_KEY`): **fixture mode** — appends NDJSON
  to `runs/latest/traces.ndjson` and prints a visible warning naming the fixture
  sink. With keys: real Langfuse ingestion (batched `POST
/api/public/ingestion` with basic auth `public:secret`, events in Langfuse's
  trace-create/span shape, `timestamp` = ISO of run start passed in — never
  `Date.now()` inside your module; the runner passes a fixed logical clock).
- `fetchTraces()` — real Langfuse read path (`GET /api/public/traces`) used by
  the standalone auditor; fixture mode reads the local NDJSON instead.

### `framework/observability/audit.ts`

```ts
export function auditRun(run: RunResult, spans: TraceSpan[]): TraceAudit;
export interface TraceAudit {
  scenarioId;
  shapeId;
  expectedSpans;
  actualSpans;
  missing;
  extra;
  outOfOrder: boolean;
  orderNotes: string[];
  budgetOk: boolean;
  budgetNotes: string[];
  piiInSpans: string[];
  notes: string[];
}
```

- Missing-span detector: expected subsequence vs actual span sequence; report
  missing (severity blocker), extra (informational), and out-of-order.
- Budget checks: summed `llm.generate` usage × list price (src/lib/cost.ts
  PRICES — labelled estimate) and total span time vs the shape's budgets.
- **PII-in-logs check**: scan every span's `input`/`output`/`attributes` for
  the PII patterns (phone regex `\+\d[\d\s]{7,}`, other contacts' emails, any
  `con_***`/`dls_***` record ids where the pattern isn't the scenario's own
  subject) → findings. A span containing raw PII is a bug by the JD's standard.
- Slowest-step note: the span with the largest `endMs - startMs`.

### `framework/observability/report.ts`

`generateTraceComplianceReport(audits, outPath)` writes
`reports/trace-compliance.md`:

- One-line actionable summary ("12 of 38 runs are missing the
  `guardrail.pii-check` span — all are send_email runs; bug
  BUG_UNLOGGED_TOOL_SPAN").
- Per-category expected-vs-actual span table (markdown table: shape, expected
  spans, actual spans, missing, verdict).
- Per-run rows for failures only, each with the trace id and the fix pointer.
- Budget table (per shape: p50/p95 span time, estimated cost per 100 runs).
- An "annotated trace" section: one good run's span tree as a code block with
  the expected steps marked.

### `framework/observability/run.ts` (CLI)

`npx tsx framework/observability/run.ts --results runs/latest/results.json
--traces runs/latest/traces.ndjson --out reports/trace-compliance.md`.

### `framework/observability/fixtures/`

One recorded Langfuse API response fixture (`langfuse-trace.fixture.json`,
header comment field `"fixture": true, "note": "..."`) used by the fixture-mode
tests so the ingest/audit paths are exercised without a key.

### `framework/observability/README.md`

What it does, how to run alone, inputs, outputs.

## Acceptance (run these, paste output)

Build a small fixture: 3 hand-written `RunResult`s + matching `TraceSpan[]`
(one with a missing guardrail span, one complete), then:

```bash
npx tsx framework/observability/run.ts --results <fixture> --traces <fixture.ndjson> --out /tmp/trace.md
```

Paste the report summary + one per-run failure row. Also demonstrate the
fixture warning text from `emitTraces`.

## Report

Format from `docs/agent-briefs/_common.md` §7.
