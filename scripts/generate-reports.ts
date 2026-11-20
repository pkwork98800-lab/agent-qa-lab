/**
 * Generates every report artefact from a single `runs/latest/results.json`.
 * ---------------------------------------------------------------------------
 * Owned by the orchestrator.
 *
 * `npm run report` aggregates the eval run into the human-readable reports
 * that a hiring manager reviews:
 *   reports/pass-fail.md            suite pass/fail matrix
 *   reports/data-integrity-findings.md  before/after DB diffs (verify module)
 *   reports/trace-compliance.md     expected vs actual spans (observability)
 *   reports/red-team-report.md      severity table + repro + fixes (red team)
 *   reports/triage-summary.md       dedupe → ticket → retest (triage)
 *
 * The judge calibration report is produced separately by `npm run calibrate`.
 * The manual test pack and app map are hand-written (agent 9 module).
 */
import { readJson } from '../src/lib/json-io.ts';
import { REPO_ROOT } from '../src/lib/config.ts';
import type { RunResult, AssertionResult, TicketCandidate } from '../src/contracts/types.ts';
import { verifyRun } from '../framework/verify/index.ts';
import { generateDataIntegrityReport } from '../framework/verify/report.ts';
import { auditRun } from '../framework/observability/audit.ts';
import { generateTraceComplianceReport } from '../framework/observability/report.ts';
import { generateRedTeamReport } from '../framework/redteam/report.ts';
import { normalise } from '../framework/triage/normalise.ts';
import { triageCandidates } from '../framework/triage/index.ts';
import { generateTriageSummaryMarkdown } from '../framework/triage/report.ts';

function suiteSummary(suite: string, results: RunResult[]): {
  total: number; passed: number; failed: number; errored: number; skipped: number;
  notable: string; costUsd: number; latencyMs: number;
} {
  const total = results.length;
  const passed = results.filter((r) => r.verdict.overall === 'pass').length;
  const failed = results.filter((r) => r.verdict.overall === 'fail').length;
  const errored = results.filter((r) => r.status === 'error').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const cost = results.reduce((s, r) => s + r.costUsd, 0);
  const latency = results.reduce((s, r) => s + r.latencyMs, 0);

  let notable = '';
  const blockers = results.filter((r) => r.verdict.failedAssertionIds.length > 0);
  if (blockers.length > 0) {
    notable = `${String(blockers.length)} scenario(s) with failures`;
  } else {
    notable = 'All scenarios passed.';
  }

  return { total, passed, failed, errored, skipped, notable, costUsd: cost, latencyMs: latency };
}

async function main(): Promise<void> {
  const results: RunResult[] = readJson(`${REPO_ROOT}/runs/latest/results.json`);
  const outDir = `${REPO_ROOT}/reports`;
  const fs = await import('node:fs');
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Pass/fail matrix
  const bySuite: Record<string, RunResult[]> = {};
  for (const r of results) {
    (bySuite[r.suite] ??= []).push(r);
  }
  const lines: string[] = [];
  lines.push('# Pass / Fail Matrix');
  lines.push('');
  lines.push(`Generated from \`runs/latest/results.json\` (${String(results.length)} scenarios).`);
  lines.push('');
  lines.push('| Suite | Pass | Fail | Error | Skip | Notable | Cost | Wall-clock |');
  lines.push('|---|---|---|---|---|---|---|---|');
  let totalCost = 0; let totalLatency = 0;
  for (const [suite, suiteResults] of Object.entries(bySuite)) {
    const s = suiteSummary(suite, suiteResults);
    totalCost += s.costUsd; totalLatency += s.latencyMs;
    lines.push(`| ${suite} | ${String(s.passed)} | ${String(s.failed)} | ${String(s.errored)} | ${String(s.skipped)} | ${s.notable} | $${s.costUsd.toFixed(4)} | ${String(s.latencyMs)}ms |`);
  }
  lines.push('');
  lines.push(`**Total:** ${String(results.filter((r) => r.verdict.overall === 'pass').length)}/${String(results.length)} passed, $${totalCost.toFixed(4)}, ${String(totalLatency)}ms`);
  lines.push('');

  // Notable failures
  const failing = results.filter((r) => r.verdict.overall === 'fail');
  if (failing.length > 0) {
    lines.push('## Failing scenarios');
    lines.push('');
    for (const r of failing) {
      const failedAssertions = r.assertions.filter((a: AssertionResult) => a.status === 'fail' || a.status === 'error');
      lines.push(`### ${r.scenarioId} — ${r.title}`);
      lines.push(`- Persona: ${r.persona} (${r.role})`);
      lines.push(`- Failed assertions: ${failedAssertions.map((a: AssertionResult) => a.assertionId).join(', ')}`);
      for (const a of failedAssertions) {
        lines.push(`  - ${a.type}: expected \`${a.expected}\`, actual \`${a.actual}\``);
      }
      lines.push('');
    }
  }

  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${outDir}/pass-fail.md`, lines.join('\n'), 'utf8');

  // 2. Data integrity findings (verify module)
  const verifyOutcomes = [];
  for (const r of results) {
    const outcome = await verifyRun(r, { baseUrl: `http://127.0.0.1:4799`, actorId: 'usr_liam' });
    verifyOutcomes.push(outcome);
  }
  await generateDataIntegrityReport(verifyOutcomes, `${outDir}/data-integrity-findings.md`);

  // 3. Trace compliance (observability module)
  const traceAudits = results.map((r) => auditRun(r, []));
  await generateTraceComplianceReport(traceAudits, `${outDir}/trace-compliance.md`);

  // 4. Red team report
  generateRedTeamReport(results, `${REPO_ROOT}/scenarios/redteam`, `${outDir}/red-team-report.md`);

  // 5. Triage summary
  const candidates: TicketCandidate[] = [];
  for (const r of results) {
    if (r.verdict.overall !== 'pass') {
      for (const a of r.assertions.filter((x: AssertionResult) => x.status === 'fail' || x.status === 'error')) {
        candidates.push(normalise({
          source: 'eval',
          scenarioId: r.scenarioId,
          signature: '',
          title: `${r.scenarioId}: ${a.type}`,
          severity: 'major',
          environment: 'offline deterministic',
          repro: [`Boot the app`, `Run scenario ${r.scenarioId}: ${r.title}`],
          expected: a.expected,
          actual: a.actual,
          evidence: { reportPath: 'reports/pass-fail.md', assertionIds: [a.assertionId], transcriptRow: 0, traceId: r.traceId },
          costUsd: r.costUsd,
          labels: [r.suite],
        }));
      }
    }
  }
  const summary = await triageCandidates(candidates, { mode: 'fixture', statePath: `${REPO_ROOT}/runs/latest/tickets-state.json` });
  await generateTriageSummaryMarkdown(summary, `${outDir}/triage-summary.md`);

  console.log(`\nReports generated in ${outDir}:`);
  console.log('- pass-fail.md, data-integrity-findings.md, trace-compliance.md');
  console.log('- red-team-report.md, triage-summary.md');
}

main().catch((err: unknown) => {
  console.error('report generation failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
