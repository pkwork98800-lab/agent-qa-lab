/**
 * redteam CLI (agent 10, run).
 * ---------------------------------------------------------------------------
 * `npx tsx framework/redteam/run.ts --results <run-results.json> --out <report.md>`
 *
 * Reads a `RunResult[]` file and writes the red-team safety report via
 * `generateRedTeamReport`. Fixture/offline: no network. ProbesPath defaults to
 * `scenarios/redteam` relative to the repo root.
 */
import { generateRedTeamReport } from './report.ts';
import type { RunResult } from '../../src/contracts/types.ts';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function parseArgs(argv: string[]): { results?: string; out?: string; probesPath?: string } {
  const out: { results?: string; out?: string; probesPath?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--results') out.results = argv[++i];
    else if (arg === '--out') out.out = argv[++i];
    else if (arg === '--probes-path') out.probesPath = argv[++i];
  }
  return out;
}

function main(argv: string[]): void {
  const { results, out, probesPath } = parseArgs(argv);
  if (!results || !out) {
    console.error(
      'Usage: npx tsx framework/redteam/run.ts --results <file> --out <file> [--probes-path <dir>]',
    );
    process.exit(1);
  }

  const raw = readFileSync(results, 'utf8');
  const runs = JSON.parse(raw) as RunResult[];
  if (!Array.isArray(runs)) throw new Error(`--results ${results} is not a RunResult[]`);

  const probes = probesPath ?? 'scenarios/redteam';
  generateRedTeamReport(runs, probes, out);

  const failed = runs.filter((r) => r.verdict.overall !== 'pass').length;
  console.log(
    `evaluated ${String(runs.length)} run(s): ${String(runs.length - failed)} passed, ${String(failed)} failed`,
  );
  console.log(`report written to ${out}`);
}

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
