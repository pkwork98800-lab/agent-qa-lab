/**
 * Generates `framework/judges/golden-set/golden-answers.jsonl`: exactly 60
 * genuine agent answers from REAL runs of `runChat` against a locally booted
 * app over the 30 `scenarios/core` scenarios, once with bugs OFF (pass-worthy)
 * and once with bugs ON (fail-worthy).
 *
 *   npx tsx framework/judges/golden-set/build.ts
 *
 * Each entry: { scenarioId, persona, question, answer, expectedOutcome, grounding }
 * where grounding carries the tools called and the before/after DB diff so the
 * mock judge can score deterministically.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../../apps/under-test/app.ts';
import { runChat } from '../../../apps/agent/index.ts';
import { diffSnapshots } from '../../../src/lib/diff.ts';
import { writeNdjson } from '../../../src/lib/json-io.ts';
import type { DbSnapshot } from '../../../src/contracts/types.ts';
import { BUG_FLAGS } from '../../../src/lib/config.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(dirname(__dirname)));
const CORE_DIR = join(REPO_ROOT, 'scenarios', 'core');
const OUT_PATH = join(REPO_ROOT, 'framework', 'judges', 'golden-set', 'golden-answers.jsonl');
const APP_PORT = 4899;
const BASE_URL = `http://127.0.0.1:${String(APP_PORT)}`;

// All four latent bug flags (the three app-owned plus the agent-owned span bug).
const ALL_BUG_FLAGS: Record<string, boolean> = Object.fromEntries(
  [...BUG_FLAGS, 'BUG_UNLOGGED_TOOL_SPAN'].map((name) => [name, true]),
);

async function requestJson(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} → HTTP ${String(response.status)}`);
  }
  const text = await response.text();
  return text.trim().length === 0 ? {} : JSON.parse(text);
}

async function resetDb(): Promise<void> {
  await requestJson('POST', '/api/v1/admin/reset');
}

async function setBugs(enabled: boolean): Promise<void> {
  const flags: Record<string, boolean> = {};
  for (const name of Object.keys(ALL_BUG_FLAGS)) flags[name] = enabled;
  await requestJson('POST', '/api/v1/admin/bugs', flags);
}

async function snapshot(): Promise<DbSnapshot> {
  return (await requestJson('GET', '/api/v1/admin/snapshot')) as DbSnapshot;
}

async function main(): Promise<void> {
  const files = readdirSync(CORE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  interface CoreScenario {
    id: string;
    persona: string;
    userProblem: string;
    expectedOutcome: unknown;
  }
  const scenarios: CoreScenario[] = [];
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(CORE_DIR, file), 'utf8')) as CoreScenario;
    scenarios.push({
      id: raw.id,
      persona: raw.persona,
      userProblem: raw.userProblem,
      expectedOutcome: raw.expectedOutcome,
    });
  }

  // Boot one app under test and reuse it for every scenario (resetting the DB
  // between runs so each scenario starts from the same seed).
  const app = createApp();
  let server!: ReturnType<typeof app.listen>;
  try {
    server = app.listen(APP_PORT);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    process.env.APP_BASE_URL = BASE_URL;
    const entries: Array<{
      scenarioId: string;
      persona: string;
      question: string;
      answer: string;
      expectedOutcome: unknown;
      grounding: { toolsCalled: unknown[]; dbDiff?: unknown };
    }> = [];

    for (const scenario of scenarios) {
      for (const bugsOn of [false, true]) {
        await resetDb();
        await setBugs(bugsOn);
        const dbBefore = await snapshot();

        const out = await runChat({
          scenarioId: scenario.id,
          messages: [{ role: 'user', content: scenario.userProblem }],
          persona: scenario.persona as never,
          bugFlags: ALL_BUG_FLAGS,
          provider: 'mock',
        });

        const dbAfter = await snapshot();
        entries.push({
          scenarioId: `${scenario.id}-${bugsOn ? 'on' : 'off'}`,
          persona: scenario.persona,
          question: scenario.userProblem,
          answer: out.finalAnswer,
          expectedOutcome: scenario.expectedOutcome,
          grounding: {
            toolsCalled: out.toolsCalled,
            dbDiff: diffSnapshots(dbBefore, dbAfter),
          },
        });
      }
    }

    writeNdjson(OUT_PATH, entries);
    console.log(`Wrote ${String(entries.length)} golden answers to ${OUT_PATH}`);
  } finally {
    server.close();
    delete process.env.APP_BASE_URL;
  }
}

void main();
