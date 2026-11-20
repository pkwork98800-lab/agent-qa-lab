#!/usr/bin/env tsx
/**
 * Triage CLI — dedupe → file → retest → close/reopen.
 *
 * Reads TicketCandidate JSON from --input, an optional retest map from
 * --retest, and writes the triage summary markdown to --out.
 *
 * Fixture mode by default (no keys required). --live requires LINEAR_API_KEY.
 *
 *   npx tsx framework/triage/run-triage.ts \
 *     --input runs/latest/tickets.json \
 *     --retest runs/latest/retest.json \
 *     --out reports/triage-summary.md
 */
import { readJson } from '../../src/lib/json-io.ts';
import { fileExists } from '../../src/lib/json-io.ts';
import type { TicketCandidate } from '../../src/contracts/types.ts';
import { triageCandidates, generateTriageSummaryMarkdown } from './index.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let input = '';
  let retest = '';
  let out = '';
  let live = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--input') input = args[++i];
    else if (arg === '--retest') retest = args[++i];
    else if (arg === '--out') out = args[++i];
    else if (arg === '--live') live = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  if (!input || !out) {
    console.error(
      'Usage: tsx framework/triage/run-triage.ts --input <path> [--retest <path>] --out <path> [--live]',
    );
    process.exit(1);
  }

  if (!fileExists(input)) {
    console.error(`Input file not found: ${input}`);
    process.exit(1);
  }

  // Live mode requires a Linear key.
  if (live) {
    const key = process.env.LINEAR_API_KEY;
    if (!key || key.trim() === '') {
      console.error(
        'LINEAR_API_KEY is required for --live mode. Run in fixture mode (default) instead.',
      );
      process.exit(1);
    }
    console.warn('Live mode: filing tickets to Linear via LINEAR_API_KEY.');
  } else {
    console.warn('Fixture mode: no external keys required. Use --live to file to Linear.');
  }

  const candidates: TicketCandidate[] = readJson<TicketCandidate[]>(input);

  let retestMap: Record<string, 'fixed' | 'still-failing'> | undefined;
  if (retest) {
    if (!fileExists(retest)) {
      console.error(`Retest file not found: ${retest}`);
      process.exit(1);
    }
    retestMap = readJson<Record<string, 'fixed' | 'still-failing'>>(retest);
  }

  const summary = await triageCandidates(candidates, {
    mode: live ? 'live' : 'fixture',
    retest: retestMap,
  });

  await generateTriageSummaryMarkdown(summary, out);

  console.error(
    `Triage complete: new=${String(summary.new)} dupes=${String(summary.duplicates)} closed=${String(summary.closed)} reopened=${String(summary.reopened)} blocked=${String(summary.blocked)} → ${out}`,
  );
}

await main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
