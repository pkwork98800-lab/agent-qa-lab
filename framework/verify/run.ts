/**
 * verify CLI (agent 6, run).
 * ---------------------------------------------------------------------------
 * `npx tsx framework/verify/run.ts --input <run-results.json> --base-url
 * <url> --out <report.md>`
 *
 * Reads a `RunResult[]` file, verifies each run against ground truth
 * (snapshots + independent API checks), and writes the data-integrity report.
 * If `--base-url` is omitted, boots its own app server via `startServer` from
 * `apps/under-test` (the surface the brief prescribes) and tears it down on
 * exit.
 */
import { verifyRun, generateDataIntegrityReport, type VerifyOutcome } from './index.ts';
import type { RunResult } from '../../src/contracts/types.ts';
import { startServer } from '../../apps/under-test/server.ts';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function parseArgs(argv: string[]): { input?: string; baseUrl?: string; out?: string } {
  const out: { input?: string; baseUrl?: string; out?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') out.input = argv[++i];
    else if (arg === '--base-url') out.baseUrl = argv[++i];
    else if (arg === '--out') out.out = argv[++i];
  }
  return out;
}

async function main(argv: string[]): Promise<void> {
  const { input, baseUrl, out } = parseArgs(argv);
  if (!input || !out) {
    console.error(
      'Usage: npx tsx framework/verify/run.ts --input <file> --base-url <url> --out <file>',
    );
    process.exit(1);
  }

  let server: { close: () => void; url: string } | undefined;
  const base = baseUrl ?? (server = startServer({})).url;

  try {
    const raw = readFileSync(input, 'utf8');
    const runs = JSON.parse(raw) as RunResult[];
    if (!Array.isArray(runs)) throw new Error(`--input ${input} is not a RunResult[]`);

    const outcomes: VerifyOutcome[] = [];
    for (const run of runs) {
      outcomes.push(await verifyRun(run, { baseUrl: base, actorId: 'usr_emma' }));
    }

    await generateDataIntegrityReport(outcomes, out);

    const failed = outcomes.filter((o) => o.status === 'fail').length;
    const blockers = outcomes
      .flatMap((o) => o.findings)
      .filter((f) => f.severity === 'blocker').length;
    console.log(
      `verified ${String(outcomes.length)} run(s): ${String(outcomes.length - failed)} passed, ${String(failed)} failed, ${String(blockers)} blocker findings`,
    );
    console.log(`report written to ${out}`);
  } finally {
    if (server) server.close();
  }
}

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
