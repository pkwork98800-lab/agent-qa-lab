/**
 * Trace-compliance report — framework/observability (agent 7).
 * ---------------------------------------------------------------------------
 * Owned paths: framework/observability/** only.
 *
 * generateTraceComplianceReport(audits, outPath) writes reports/trace-compliance.md.
 *
 * Contents:
 *  - one-line actionable summary;
 *  - per-category expected-vs-actual span table (shape, expected spans, actual
 *    spans, missing, verdict);
 *  - per-run rows for failures only, each with trace id and fix pointer;
 *  - budget table (per shape: p50/p95 span time, estimated cost per 100 runs);
 *  - an "annotated trace" section: one good run's span tree as a code block
 *    with the expected steps marked.
 *
 * Deterministic: tables are ordered by shape id / scenario id, no wall-clock
 * anywhere, so the same audits always regenerate byte-identically.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TraceSpan } from '../../src/contracts/types.ts';
import type { TraceAudit } from './audit.ts';

/** Generate the trace-compliance markdown report. */
export function generateTraceComplianceReport(
  audits: TraceAudit[],
  outPath: string,
): Promise<void> {
  const ordered = [...audits].sort((a, b) => (a.scenarioId < b.scenarioId ? -1 : 1));
  const lines: string[] = [];

  lines.push('# Trace Compliance Report');
  lines.push('');
  lines.push(
    'Audits every run trace against its expected span shape, budgets and PII ' +
      'hygiene — "a step that is not logged is a bug".',
  );
  lines.push('');

  // ---- one-line summary ----
  const totalRuns = ordered.length;
  const failingRuns = ordered.filter(isFailure);
  const missingSpanRuns = ordered.filter((a) => a.missing.length > 0);
  const piiRuns = ordered.filter((a) => a.piiInSpans.length > 0);
  const budgetRuns = ordered.filter((a) => !a.budgetOk);
  lines.push('## Summary');
  lines.push('');
  lines.push(
    `${String(totalRuns)} run${
      totalRuns === 1 ? '' : 's'
    } audited. ${String(failingRuns.length)} failing${
      failingRuns.length === 0
        ? '.'
        : `: ${String(missingSpanRuns.length)} missing span(s), ${String(
            piiRuns.length,
          )} PII-in-span(s), ${String(budgetRuns.length)} over budget.`
    }`,
  );
  if (missingSpanRuns.length > 0) {
    const byShape = new Map<string, number>();
    for (const a of missingSpanRuns) {
      byShape.set(a.shapeId, (byShape.get(a.shapeId) ?? 0) + 1);
    }
    const top = [...byShape.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([shapeId, count]) => `${String(count)}× ${shapeId}`)
      .join('; ');
    lines.push('Missing-span pattern: ' + top + '.');
  }
  lines.push('');

  // ---- per-category expected-vs-actual span table ----
  lines.push('## Expected vs actual spans by shape');
  lines.push('');
  lines.push('| shape | required spans | actual spans (sample) | missing | verdict |');
  lines.push('|---|---|---|---|---|');
  const byShape = groupByShape(ordered);
  for (const [shapeId, shapeAudits] of byShape) {
    const required = shapeAudits[0].expectedSpans;
    const missingCount = shapeAudits.filter((a) => a.missing.length > 0).length;
    const verdict = missingCount === 0 ? 'pass' : 'fail';
    const actualSample = [...new Set(shapeAudits.flatMap((a) => a.actualSpans))].join(', ');
    lines.push(
      `| ${shapeId} | ${required.join(' → ')} | ${actualSample} | ${String(
        missingCount,
      )} of ${String(shapeAudits.length)} run(s) missing | ${verdict} |`,
    );
  }
  lines.push('');

  // ---- per-run failure rows ----
  lines.push('## Per-run failures');
  lines.push('');
  if (failingRuns.length === 0) {
    lines.push('No run failures — every trace matches its expected shape, budget and PII hygiene.');
  } else {
    lines.push(
      '| scenario | trace id | shape | missing | out of order | budget | PII | fix pointer |',
    );
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const a of failingRuns) {
      const fix = fixPointer(a);
      const piiText = a.piiInSpans.length === 0 ? 'none' : String(a.piiInSpans.length);
      lines.push(
        `| ${a.scenarioId} | ${a.traceId ?? '—'} | ${a.shapeId} | ${
          a.missing.join('; ') || '—'
        } | ${a.outOfOrder ? 'yes' : 'no'} | ${a.budgetOk ? 'ok' : 'over'} | ${piiText} | ${fix} |`,
      );
    }
  }
  lines.push('');

  // ---- budget table ----
  lines.push('## Budget table by shape');
  lines.push('');
  lines.push('| shape | runs | p50 span time (ms) | p95 span time (ms) | est. cost per 100 runs |');
  lines.push('|---|---|---|---|---|');
  for (const [shapeId, shapeAudits] of byShape) {
    const durations: number[] = [];
    let costSum = 0;
    let count = 0;
    for (const a of shapeAudits) {
      durations.push(...a.spanDurationsMs);
      costSum += a.llmCostUsd;
      count += 1;
    }
    durations.sort((a, b) => a - b);
    const p50 = percentile(durations, 0.5);
    const p95 = percentile(durations, 0.95);
    const costPer100 = count > 0 ? (costSum / count) * 100 : 0;
    lines.push(
      `| ${shapeId} | ${String(count)} | ${String(p50)} | ${String(p95)} | $${costPer100.toFixed(
        4,
      )} |`,
    );
  }
  lines.push('');

  // ---- annotated trace ----
  lines.push('## Annotated trace (good run)');
  lines.push('');
  const goodRun = ordered.find(
    (a) =>
      a.missing.length === 0 && !a.outOfOrder && a.budgetOk && a.piiInSpans.length === 0 && a.spans,
  );
  if (!goodRun || !goodRun.spans) {
    lines.push('No fully clean run available to annotate.');
  } else {
    lines.push(
      `Run ${goodRun.scenarioId} (shape ${goodRun.shapeId}, trace ${goodRun.traceId ?? '—'}).`,
    );
    lines.push('');
    lines.push('```text');
    lines.push(...annotateTrace(goodRun.spans, goodRun.expectedSpans));
    lines.push('```');
  }
  lines.push('');

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  return Promise.resolve();
}

/** A run fails when any span-shape, budget or PII check fails. */
function isFailure(a: TraceAudit): boolean {
  return a.missing.length > 0 || a.outOfOrder || !a.budgetOk || a.piiInSpans.length > 0;
}

function groupByShape(audits: TraceAudit[]): Map<string, TraceAudit[]> {
  const map = new Map<string, TraceAudit[]>();
  for (const a of audits) {
    const bucket = map.get(a.shapeId) ?? [];
    bucket.push(a);
    map.set(a.shapeId, bucket);
  }
  return map;
}

function fixPointer(a: TraceAudit): string {
  if (a.missing.length > 0) {
    return 'emit ' + a.missing.join(' + ') + ' span(s) before llm.generate';
  }
  if (a.outOfOrder) return 're-order spans to match the shape subsequence';
  if (!a.budgetOk) return 'tune latency / cost to the shape budget';
  return 'remove PII from span input/output/attributes';
}

/** Nearest-rank percentile (0..1). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

/** Render one run's span tree as indented lines, marking expected steps. */
function annotateTrace(spans: TraceSpan[], expectedSpans: string[]): string[] {
  const expectedSet = new Set(expectedSpans);
  const children = new Map<string, TraceSpan[]>();
  const roots: TraceSpan[] = [];
  for (const span of spans) {
    if (span.parentId === null) roots.push(span);
    else {
      const bucket = children.get(span.parentId) ?? [];
      bucket.push(span);
      children.set(span.parentId, bucket);
    }
  }
  roots.sort((a, b) => a.startMs - b.startMs);
  for (const bucket of children.values()) {
    bucket.sort((a, b) => a.startMs - b.startMs);
  }

  const lines: string[] = [];
  const walk = (span: TraceSpan, depth: number): void => {
    const mark = expectedSet.has(span.name) ? '✓' : '·';
    const duration = span.endMs - span.startMs;
    const extra = span.model ? ' [' + span.model + ']' : '';
    const usage = span.usage
      ? ' usage=' + String(span.usage.promptTokens) + '/' + String(span.usage.completionTokens)
      : '';
    lines.push(
      '  '.repeat(depth) +
        mark +
        ' ' +
        span.name +
        ' (' +
        span.id +
        ')' +
        extra +
        usage +
        ' +' +
        String(duration) +
        'ms',
    );
    for (const child of children.get(span.id) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return lines;
}
