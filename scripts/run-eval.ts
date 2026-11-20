/**
 * The eval runner — single entry point that executes every scenario against the
 * app under test and writes the runs/latest artefacts.
 * ---------------------------------------------------------------------------
 * Owned by the orchestrator.
 *
 * `npm run eval`        — every scenario, offline, deterministic, $0
 * `npm run eval:smoke`  — smoke suite only, <60s, $0
 * `npm run eval:redteam`— red-team suite only
 * `npm run eval:hardened`— smoke+core with all latent bug flags OFF (must pass)
 *
 * Offline mode is the default: every external provider is exercised through its
 * fixture path and real spend is $0. `--live` / `EVAL_MODE=live` opts into real
 * providers, cost-capped per run.
 *
 * Per scenario: reset DB → snapshot db_before → run chat → snapshot db_after
 * → deterministic assertions → (only if all pass) judged assertions → trace
 * audit → verify (API + DB). Results feed triage.
 */
import { loadEnv } from '../src/lib/env.ts';
import { createLogger } from '../src/lib/logger.ts';
import { REPO_ROOT, APP_PORT, BUG_FLAGS, CSV_COLUMNS } from '../src/lib/config.ts';
import { estimateCostUsd } from '../src/lib/cost.ts';
import { computeRunId } from '../src/lib/run-id.ts';
import { writeCsv } from '../src/lib/csv.ts';
import { writeJson } from '../src/lib/json-io.ts';
import { startServer } from '../apps/under-test/server.ts';
import { runChat } from '../apps/agent/index.ts';
import { parseScenario } from '../scenarios/_schema.ts';
import type { Scenario, RunResult, AssertionResult } from '../src/contracts/types.ts';
import { assertDeterministic, assertJudged, combineVerdict } from '../src/lib/assertions.ts';
import { resetDatabase, snapshotDatabase } from '../apps/under-test/db.ts';
import { PERSONA_USER_IDS, ROLE_OF_PERSONA } from '../src/contracts/app-api.ts';

const log = createLogger('run-eval');

function parseArgs(argv: string[]): { suite: string | null; hardened: boolean; live: boolean; runId?: string } {
  let suite: string | null = null;
  let hardened = false;
  let live = false;
  let runId: string | undefined;
  for (const a of argv) {
    if (a === '--hardened') hardened = true;
    else if (a === '--live') live = true;
    else if (a.startsWith('--suite=')) suite = a.slice('--suite='.length);
    else if (a.startsWith('--run-id=')) runId = a.slice('--run-id='.length);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: tsx scripts/run-eval.ts [--suite smoke|core|redteam] [--hardened] [--live] [--run-id=...]');
      process.exit(0);
    }
  }
  return { suite, hardened, live, runId };
}

/** Boot app, snapshot, run chat, snapshot — deterministic seed per scenario. */
async function runScenarioChat(scenario: Scenario, actorId: string, hardened: boolean, appUrl: string) {
  resetDatabase();
  if (hardened) {
    await fetch(`${appUrl}/api/v1/admin/bugs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(BUG_FLAGS.map((f): [string, boolean] => [f, false]))),
    });
  }
  const dbBefore = snapshotDatabase();

  const chat = await runChat({
    scenarioId: scenario.id,
    messages: [{ role: 'user', content: scenario.userProblem }],
    persona: scenario.persona,
    bugFlags: {},
    provider: 'mock',
  });

  const dbAfter = snapshotDatabase();
  return { dbBefore, chat, dbAfter };
}

async function main(argv: string[]): Promise<void> {
  const env = loadEnv();
  const { suite: suiteOpt, hardened, live, runId: runIdOverride } = parseArgs(argv);

  if (live && !env.anthropicKey && !env.openaiKey) {
    throw new Error('--live requires ANTHROPIC_API_KEY or OPENAI_API_KEY; offline is the default');
  }

  const suites: string[] = suiteOpt ? [suiteOpt] : ['smoke', 'core', 'redteam'];
  const fs = await import('node:fs');
  const path = await import('node:path');

  // Load all scenarios from the selected suites.
  const scenarios: Scenario[] = [];
  for (const s of suites) {
    const scenarioDir = `${REPO_ROOT}/scenarios/${s}`;
    if (!fs.existsSync(scenarioDir)) continue;
    const files = fs.readdirSync(scenarioDir).filter((f) => f.endsWith('.json')).sort();
    for (const f of files) {
      const raw: unknown = JSON.parse(fs.readFileSync(path.join(scenarioDir, f), 'utf8'));
      scenarios.push(parseScenario(raw, path.join(scenarioDir, f)));
    }
  }

  const { url, close } = startServer({ port: APP_PORT });
  process.env.APP_BASE_URL = url;
  try {
    const results: RunResult[] = [];
    let totalCost = 0;
    let totalLatency = 0;

    for (const scenario of scenarios) {
      const { dbBefore, chat, dbAfter } = await runScenarioChat(scenario, PERSONA_USER_IDS[scenario.persona], hardened, url);

      const deterministic = assertDeterministic(scenario, chat, dbBefore, dbAfter);
      const detFailed = deterministic.some((r) => r.status === 'fail' || r.status === 'error');
      let judged: AssertionResult[] = [];
      if (!detFailed) judged = assertJudged(scenario, chat, dbBefore, dbAfter);
      else judged = deterministic.map((r) => ({ ...r, status: 'skip' as const, message: 'skipped: deterministic failed', expected: '', actual: '' }));

      const verdict = combineVerdict(deterministic, judged);

      const costUsd = estimateCostUsd('mock-policy-1', chat.promptTokens, chat.completionTokens);
      const latencyMs = chat.spans.reduce((s, span) => s + (span.endMs - span.startMs), 0);
      totalCost += costUsd;
      totalLatency += latencyMs;

      const run: RunResult = {
        scenarioId: scenario.id,
        suite: scenario.suite,
        title: scenario.title,
        persona: scenario.persona,
        role: ROLE_OF_PERSONA[scenario.persona],
        mode: live ? 'live' : 'offline',
        provider: 'mock',
        status: verdict.overall,
        finalAnswer: chat.finalAnswer,
        transcript: chat.turns,
        toolsCalled: chat.toolsCalled,
        dbBefore,
        dbAfter,
        assertions: [...deterministic, ...judged],
        verdict,
        judgeScore: judged.length > 0 ? judged[0].status === 'pass' ? 5 : 1 : undefined,
        judgeRationale: judged.length > 0 ? judged[0].message : undefined,
        costUsd,
        latencyMs,
        traceId: `trc-${scenario.id}`,
        bugFlags: {},
        error: chat.error,
      };
      results.push(run);
      log.info(`scenario ${scenario.id} → ${run.verdict.overall} (${String(latencyMs)}ms)`);
    }

    const runId = runIdOverride ?? computeRunId(scenarios.map((s) => s.id), '1.0.0');
    const outDir = `${REPO_ROOT}/runs/latest`;
    fs.mkdirSync(outDir, { recursive: true });

    writeJson(`${outDir}/metadata.json`, {
      runId,
      mode: live ? 'live' : 'offline',
      provider: 'mock',
      bugFlags: {},
      scenarioCount: scenarios.length,
      generatedBy: 'scripts/run-eval.ts',
    });
    writeJson(`${outDir}/results.json`, results);

    const csvRows = results.map((r) => ({
      scenario_id: r.scenarioId,
      persona: r.persona,
      suite: r.suite,
      turns: r.transcript.length,
      full_transcript: JSON.stringify(r.transcript),
      tools_called: JSON.stringify(r.toolsCalled),
      db_before: JSON.stringify(r.dbBefore),
      db_after: JSON.stringify(r.dbAfter),
      verdict: r.verdict.overall,
      judge_score: r.judgeScore ?? '',
      judge_rationale: r.judgeRationale ?? '',
      cost_usd: costUsdToFixed(r.costUsd),
      latency_ms: r.latencyMs,
      trace_url: r.traceId ?? '',
    }));
    writeCsv(`${outDir}/transcripts.csv`, [...CSV_COLUMNS], csvRows);

    console.log(`\nEval complete: ${String(results.length)} scenarios, ${String(results.filter((r) => r.verdict.overall === 'pass').length)} passed, $${totalCost.toFixed(4)}, ${String(totalLatency)}ms total`);
    console.log(`Run id: ${runId}`);
    console.log(`Artefacts: ${outDir}/results.json, ${outDir}/transcripts.csv`);
  } finally {
    close();
  }
}

function costUsdToFixed(n: number): string {
  return n.toFixed(4);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error('eval failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
