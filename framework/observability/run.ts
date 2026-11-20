/**
 * Trace-compliance CLI — framework/observability (agent 7).
 * ---------------------------------------------------------------------------
 * Owned paths: framework/observability/** only.
 *
 * Usage:
 *   npx tsx framework/observability/run.ts \
 *     --results runs/latest/results.json \
 *     --traces runs/latest/traces.ndjson \
 *     --out reports/trace-compliance.md
 *
 * Reads RunResult[] and Trace[] (one Trace per NDJSON line), audits each run's
 * trace against its expected shape, and writes the compliance report. Works
 * offline: traces.ndjson is the fixture sink written by emitTraces in fixture
 * mode. No wall-clock is read.
 */

import { readJson } from '../../src/lib/json-io.ts';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { RunResult, Trace } from '../../src/contracts/types.ts';
import { auditRun } from './audit.ts';
import { generateTraceComplianceReport } from './report.ts';

interface CliArgs {
  results: string;
  traces: string;
  out: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { results: '', traces: '', out: '' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value.startsWith('--')) {
      continue;
    }
    if (flag === '--results') args.results = value;
    else if (flag === '--traces') args.traces = value;
    else if (flag === '--out') args.out = value;
    i++;
  }
  if (!args.results || !args.traces || !args.out) {
    throw new Error(
      'Usage: tsx framework/observability/run.ts --results <results.json> ' +
        '--traces <traces.ndjson> --out <report.md>',
    );
  }
  return args;
}

function readTraces(path: string): Trace[] {
  const text = readFileSync(path, 'utf8');
  const traces: Trace[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    traces.push(JSON.parse(trimmed) as Trace);
  }
  return traces;
}

async function main(argv: string[]): Promise<void> {
  const { results, traces, out } = parseArgs(argv);
  const runs: RunResult[] = readJson(results);
  const allTraces = readTraces(traces);

  const audits = runs.map((run) => {
    const trace = allTraces.find(
      (t) => t.traceId === run.traceId || t.scenarioId === run.scenarioId,
    );
    const spans = trace?.spans ?? [];
    return auditRun(run, spans);
  });

  await generateTraceComplianceReport(audits, out);
  console.log(`trace-compliance report written to ${out} (${String(audits.length)} audits)`);
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  void main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(String(err));
    process.exit(1);
  });
}
