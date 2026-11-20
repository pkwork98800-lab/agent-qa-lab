# framework/observability — trace-compliance auditor

Owns `framework/observability/**` only. Implements the JD line **"a step that is
not logged is a bug"**: every run's trace is audited against its expected span
shape, its latency/cost budgets, and PII-in-spans hygiene.

## What it does

- `shapes.ts` — the trace-shape catalogue from BUILD-CONTRACT §5
  (`read-lookup`, `update-record`, `create-record`, `email-send`, `multi-step`,
  `refusal`) plus `shapeForCategory(category)`.
- `sink.ts` + `langfuse-client.ts` — `emitTraces(traces)`. Default (no
  `LANGFUSE_SECRET_KEY`) is **fixture mode**: appends NDJSON to
  `runs/latest/traces.ndjson` and prints a visible warning naming the fixture
  sink. With keys, posts to Langfuse `POST /api/public/ingestion` (basic auth
  `public:secret`, trace-create/span-create events) using a logical clock
  passed in by the runner — never `Date.now()`.
- `audit.ts` — `auditRun(run, spans): TraceAudit`. Missing-span detector
  (ordered subsequence), extra-span reporting, out-of-order detection, budget
  checks (estimated LLM cost × list price + total span time vs shape budgets),
  PII-in-spans scan (phone `\+\d[\d\s]{7,}`, emails, record ids), slowest-step
  note.
- `report.ts` — `generateTraceComplianceReport(audits, outPath)` writes
  `reports/trace-compliance.md`: one-line summary, per-shape expected-vs-actual
  table, per-run failure rows, budget table (p50/p95 span time, cost per 100
  runs), annotated trace.
- `run.ts` — CLI: `npx tsx framework/observability/run.ts --results ... --traces ... --out ...`.
- `fixtures/langfuse-trace.fixture.json` — recorded Langfuse response for
  offline tests.

## How to run alone

```bash
npx tsx framework/observability/run.ts \
  --results runs/latest/results.json \
  --traces runs/latest/traces.ndjson \
  --out reports/trace-compliance.md
```

Offline by default: no `LANGFUSE_SECRET_KEY` means fixture mode and the
fixture warning prints to stderr. Live Langfuse ingestion is opt-in via
`LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` (+ optional `LANGFUSE_HOST`).

## Inputs

- `runs/latest/results.json` — `RunResult[]` (from the eval runner).
- `runs/latest/traces.ndjson` — one `Trace` per line (from `emitTraces`).

## Outputs

- `reports/trace-compliance.md` — the compliance report.
- `runs/latest/traces.ndjson` — fixture sink (append-only, one Trace per line).

## Determinism

No wall-clock is read anywhere in this module. Span timings come from the
monotonic ticks already on spans (the agent's logical clock); report tables are
ordered by id. The same inputs regenerate byte-identically.

## Contracts used (read-only)

- `src/contracts/types.ts` — `RunResult`, `TraceSpan`, `Trace`, `TraceExpectation`.
- `src/lib/cost.ts` — `estimateCostUsd` / `PRICES` (list-price estimates only).
