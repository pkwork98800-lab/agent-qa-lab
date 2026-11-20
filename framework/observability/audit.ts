/**
 * Trace compliance audit — framework/observability (agent 7).
 * ---------------------------------------------------------------------------
 * Owned paths: framework/observability/** only.
 *
 * Implements BUILD-CONTRACT §6 "Span rules" and the JD line "a step that is
 * not logged is a bug": every run's trace is audited against its expected
 * trace shape, its budgets, and PII hygiene. No wall-clock is read here — all
 * timings come from the monotonic ticks already on the spans (the agent's
 * logical clock), so audits are deterministic.
 *
 * Exports auditRun(run, spans): TraceAudit (the frozen module API,
 * BUILD-CONTRACT §7) plus the pure helpers it composes.
 */

import { estimateCostUsd } from '../../src/lib/cost.ts';
import type { RunResult, TraceExpectation, TraceSpan } from '../../src/contracts/types.ts';
import {
  categoryForScenarioId,
  expectationForScenario,
  shapeById,
  type TraceShape,
} from './shapes.ts';

/** Frozen module API result type (BUILD-CONTRACT §7). Optional fields carry
 * the raw timing/cost/trace data the report generator needs for its budget
 * table and annotated trace; they are backward-compatible additions. */
export interface TraceAudit {
  scenarioId: string;
  shapeId: string;
  traceId?: string;
  expectedSpans: string[];
  actualSpans: string[];
  missing: string[];
  extra: string[];
  outOfOrder: boolean;
  orderNotes: string[];
  budgetOk: boolean;
  budgetNotes: string[];
  piiInSpans: string[];
  llmCostUsd: number;
  spanDurationsMs: number[];
  spans?: TraceSpan[];
  notes: string[];
}

/** PII patterns scanned for inside spans (BUILD-CONTRACT §5 no-pii-in-outbound,
 * applied to trace logs by this module's JD). Phone and email patterns are
 * always PII. Record ids (con_* and dls_*) are flagged as potential
 * cross-record leakage; callers may pass own record ids to exempt the
 * scenario's own subject entities. */
const PHONE_REGEX = new RegExp('\\+\\d[\\d\\s]{7,}');
const EMAIL_REGEX = new RegExp('[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}');
const RECORD_ID_REGEX = new RegExp('\\b(con_|dls_|inv_|act_|dli_|usr_|cmp_|tm_)\\w*', 'g');

/** Audit one run's trace against its expected shape, budgets and PII hygiene. */
export function auditRun(run: RunResult, spans: TraceSpan[]): TraceAudit {
  const expectation = expectationForScenario(categoryForScenarioId(run.scenarioId), undefined);
  const actualSpans = spans.map((span) => span.name);
  const shape = shapeById(expectation.shapeId);

  const order = checkOrder(expectation.requiredSpans, actualSpans);
  const missing = order.missing;
  const extra = order.extra;
  const outOfOrder = order.outOfOrder;
  const orderNotes: string[] = [];
  if (missing.length > 0) {
    orderNotes.push(`missing span(s): ${missing.join(', ')} — a step that is not logged is a bug`);
  }
  if (extra.length > 0) {
    orderNotes.push(`extra span(s) not in shape: ${extra.join(', ')}`);
  }
  if (outOfOrder) {
    orderNotes.push('required spans appear out of order');
  }

  const spanDurationsMs = spans.map((span) => span.endMs - span.startMs);
  const llmCostUsd = estimatedLlmCostUsd(spans);
  const budget = checkBudget(spans, expectation, shape, llmCostUsd);
  const pii = checkPiiInSpans(spans, run.scenarioId);
  const slowest = slowestStep(spans);
  const notes: string[] = [...budget.notes];
  if (slowest) {
    notes.push(
      `slowest step: ${slowest.name} (${String(slowest.durationMs)}ms, span ${slowest.id})`,
    );
  }
  notes.push(`spans emitted: ${String(spans.length)}`);

  return {
    scenarioId: run.scenarioId,
    shapeId: expectation.shapeId,
    traceId: run.traceId,
    expectedSpans: expectation.requiredSpans,
    actualSpans,
    missing,
    extra,
    outOfOrder,
    orderNotes,
    budgetOk: budget.ok,
    budgetNotes: budget.notes,
    piiInSpans: pii,
    llmCostUsd,
    spanDurationsMs,
    spans,
    notes,
  };
}

/** Estimated LLM cost for a run's llm.generate spans, using list prices
 * (src/lib/cost.ts PRICES — labelled estimate; unknown models estimate $0). */
function estimatedLlmCostUsd(spans: TraceSpan[]): number {
  let total = 0;
  for (const span of spans) {
    if (span.name !== 'llm.generate') continue;
    const usage = span.usage;
    const model = span.model ?? 'unknown';
    if (usage) {
      total += estimateCostUsd(model, usage.promptTokens, usage.completionTokens);
    }
  }
  return Math.round(total * 1e6) / 1e6;
}

/** Ordered-subsequence check: does required appear in actual in order?
 * Returns missing items, extra items, and an out-of-order flag. */
function checkOrder(
  required: readonly string[],
  actual: readonly string[],
): {
  missing: string[];
  extra: string[];
  outOfOrder: boolean;
} {
  const requiredSet = new Set(required);
  const extra = actual.filter((name) => !requiredSet.has(name));

  let reqIdx = 0;
  let actualIdx = 0;
  const missing: string[] = [];
  let outOfOrder = false;

  while (reqIdx < required.length) {
    const target = required[reqIdx];
    let foundAt = -1;
    for (let i = actualIdx; i < actual.length; i++) {
      if (actual[i] === target) {
        foundAt = i;
        break;
      }
    }
    if (foundAt === -1) {
      missing.push(target);
      reqIdx++;
      continue;
    }
    actualIdx = foundAt + 1;
    reqIdx++;
  }

  const matchedPositions: number[] = [];
  let pos = 0;
  for (const name of required) {
    let foundAt = -1;
    for (let i = pos; i < actual.length; i++) {
      if (actual[i] === name) {
        foundAt = i;
        break;
      }
    }
    matchedPositions.push(foundAt);
    if (foundAt !== -1) pos = foundAt + 1;
  }
  for (let i = 1; i < matchedPositions.length; i++) {
    if (matchedPositions[i] === -1 || matchedPositions[i - 1] === -1) continue;
    if (matchedPositions[i] < matchedPositions[i - 1]) {
      outOfOrder = true;
      break;
    }
  }
  if (missing.length > 0) outOfOrder = true;

  return { missing, extra, outOfOrder };
}

/** Budget checks: estimated LLM cost vs maxCostUsd and total span time vs
 * maxLatencyMs. Costs are list-price estimates (src/lib/cost.ts PRICES),
 * labelled as estimates wherever shown; offline runs meter $0.00. */
function checkBudget(
  spans: TraceSpan[],
  expectation: TraceExpectation,
  shape: TraceShape | undefined,
  llmCostUsd: number,
): { ok: boolean; notes: string[] } {
  const notes: string[] = [];
  let ok = true;
  const estimatedCostUsd = llmCostUsd;

  const maxCost = expectation.maxCostUsd ?? shape?.budget.maxCostUsd ?? 0;
  if (maxCost > 0 && estimatedCostUsd > maxCost) {
    ok = false;
    notes.push(
      `estimated LLM cost $${estimatedCostUsd.toFixed(4)} exceeds shape budget $${maxCost.toFixed(2)}`,
    );
  } else if (maxCost > 0) {
    notes.push(
      `estimated LLM cost $${estimatedCostUsd.toFixed(4)} within shape budget $${maxCost.toFixed(2)}`,
    );
  } else {
    notes.push(`estimated LLM cost $${estimatedCostUsd.toFixed(4)} (no cost budget set)`);
  }

  const totalTimeMs = spans.length > 0 ? Math.max(0, ...spans.map((s) => s.endMs - s.startMs)) : 0;
  const maxLatency = expectation.maxLatencyMs ?? shape?.budget.maxLatencyMs;
  if (maxLatency !== undefined) {
    if (totalTimeMs > maxLatency) {
      ok = false;
      notes.push(
        `total span time ${String(totalTimeMs)}ms exceeds shape latency budget ${String(maxLatency)}ms`,
      );
    } else {
      notes.push(
        `total span time ${String(totalTimeMs)}ms within shape latency budget ${String(maxLatency)}ms`,
      );
    }
  }

  return { ok, notes };
}

/** PII-in-spans check: scan input/output/attributes of every span for phone
 * numbers, emails and record ids. Returns findings as strings. */
function checkPiiInSpans(spans: TraceSpan[], scenarioId: string): string[] {
  const findings: string[] = [];
  for (const span of spans) {
    const haystack = [
      span.input,
      span.output,
      span.attributes ? JSON.stringify(span.attributes) : '',
    ]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .join('\n');
    if (haystack.length === 0) continue;

    const labels: string[] = [];
    if (PHONE_REGEX.test(haystack)) labels.push('phone number');
    if (EMAIL_REGEX.test(haystack)) labels.push('email address');
    const recordIds = [...haystack.matchAll(RECORD_ID_REGEX)].map((m) => m[0]);
    const foreignRecordIds = recordIds.filter((id) => !isOwnRecordId(id, scenarioId));
    if (foreignRecordIds.length > 0) {
      labels.push(`record id(s): ${[...new Set(foreignRecordIds)].join(', ')}`);
    }
    if (labels.length > 0) {
      findings.push(`span ${span.id} (${span.name}): ${labels.join('; ')}`);
    }
  }
  return findings;
}

/** Heuristic: a record id is own to the scenario when it appears in the
 * scenario id itself. Keeps the check deterministic without entity context;
 * see KNOWN LIMITS in the module README. */
function isOwnRecordId(id: string, scenarioId: string): boolean {
  return scenarioId.includes(id);
}

/** The span with the largest endMs - startMs (monotonic ticks). */
function slowestStep(
  spans: TraceSpan[],
): { id: string; name: string; durationMs: number } | undefined {
  let best: { id: string; name: string; durationMs: number } | undefined;
  for (const span of spans) {
    const durationMs = span.endMs - span.startMs;
    if (best === undefined || durationMs > best.durationMs) {
      best = { id: span.id, name: span.name, durationMs };
    }
  }
  return best;
}
