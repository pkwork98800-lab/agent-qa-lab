/**
 * Promptfoo config for agent-qa-lab — TS/ESM (promptfoo 0.119 supports this).
 * ---------------------------------------------------------------------------
 * Wraps the same agent (`runChat` from `apps/agent/index.ts`) behind
 * promptfoo's provider interface via `framework/promptfoo/provider.ts`.
 *
 * Tests are loaded dynamically from `scenarios/core/scn-core-00[1-5].json`
 * — a fixed 5-scenario subset. The full suite (smoke + core) is the native
 * runner's job (`scripts/run-eval.ts`).
 *
 * Runs via: `promptfoo eval -c framework/promptfoo/promptfooconfig.ts`
 * (the package.json `eval:promptfoo` script references a `.yaml` config that
 * does not exist yet — see KNOWN LIMITS).
 *
 * Limits: subset of scenarios only; no DB snapshot/restore between cases;
 * `dbDiff` is not populated by the provider (agent 4 does not own DB snapshot
 * logic).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import provider from './provider.ts';

const SCENARIO_DIR = join(process.cwd(), 'scenarios', 'core');

/** Promptfoo requires providers as functions (not plain objects). */
const callApi = async (
  prompt: string,
  context: { vars?: Record<string, unknown> },
): Promise<{
  output: string;
  metadata?: { toolsCalled?: unknown[]; spans?: unknown[]; scenarioId?: string };
}> => {
  const result = await provider.callApi(prompt, context);
  return { output: result.output, metadata: result.metadata };
};
callApi.label = 'agent-qa-lab';

/** Map scenario assertions to promptfoo assertion configurations. */
async function buildAssertions(scenario: unknown): Promise<unknown[]> {
  const assertions: unknown[] = [];
  const scenarioAssertions = (scenario as { assertions?: unknown[] }).assertions ?? [];
  for (const a of scenarioAssertions) {
    const type = (a as { type?: string }).type;
    switch (type) {
      case 'tool-called': {
        const tool = (a as { tool?: string }).tool;
        // @ts-ignore — JS assertion module has no .d.ts; eslint ignores this dir
        const mod = await import('./assertions/assertToolsCalled.js');
        assertions.push({
          type: 'javascript',
          value: (
            outputString: unknown,
            ctx: {
              vars?: Record<string, unknown>;
              provider?: unknown;
              providerResponse?: { metadata?: { toolsCalled?: unknown[] } };
            } = {},
          ) =>
            mod.default(
              { output: outputString, metadata: ctx.providerResponse?.metadata ?? {} },
              { vars: { expectedTools: [tool], ...(ctx.vars || {}) }, provider: ctx.provider },
            ),
        });
        break;
      }
      case 'tool-not-called': {
        const tool = (a as { tool?: string }).tool;
        // @ts-ignore — JS assertion module has no .d.ts; eslint ignores this dir
        const mod = await import('./assertions/assertNoToolCalled.js');
        assertions.push({
          type: 'javascript',
          value: (
            outputString: unknown,
            ctx: {
              vars?: Record<string, unknown>;
              provider?: unknown;
              providerResponse?: { metadata?: { toolsCalled?: unknown[] } };
            } = {},
          ) =>
            mod.default(
              { output: outputString, metadata: ctx.providerResponse?.metadata ?? {} },
              { vars: { forbiddenTool: tool, ...(ctx.vars || {}) }, provider: ctx.provider },
            ),
        });
        break;
      }
      case 'db-consistency': {
        const id = (a as { id?: string }).id;
        // @ts-ignore — JS assertion module has no .d.ts; eslint ignores this dir
        const mod = await import('./assertions/assertDbConsistent.js');
        assertions.push({
          type: 'javascript',
          value: (
            outputString: unknown,
            ctx: {
              vars?: Record<string, unknown>;
              provider?: unknown;
              providerResponse?: { metadata?: { toolsCalled?: unknown[] } };
            } = {},
          ) =>
            mod.default(
              { output: outputString, metadata: ctx.providerResponse?.metadata ?? {} },
              { vars: { dealId: id, ...(ctx.vars || {}) }, provider: ctx.provider },
            ),
        });
        break;
      }
      case 'no-pii-in-outbound': {
        // @ts-ignore — JS assertion module has no .d.ts; eslint ignores this dir
        const mod = await import('./assertions/assertNoPiiInOutbound.js');
        assertions.push({
          type: 'javascript',
          value: (
            outputString: unknown,
            ctx: {
              vars?: Record<string, unknown>;
              provider?: unknown;
              providerResponse?: { metadata?: { toolsCalled?: unknown[] } };
            } = {},
          ) =>
            mod.default(
              { output: outputString, metadata: ctx.providerResponse?.metadata ?? {} },
              { vars: { ...(ctx.vars || {}) }, provider: ctx.provider },
            ),
        });
        break;
      }
      case 'response-contains': {
        const text = (a as { text?: string }).text;
        const regex = (a as { regex?: string }).regex;
        const anyOf = (a as { anyOf?: string[] }).anyOf;
        if (anyOf && anyOf.length > 0) {
          assertions.push({ type: 'contains-any', value: anyOf });
        } else if (text) {
          assertions.push({ type: 'contains', value: text });
        } else if (regex) {
          assertions.push({ type: 'regex', value: regex });
        }
        break;
      }
      default:
        // llm-rubric, trace-shape, db-field-equals, api-response-matches,
        // permission-outcome, etc. are not expressible in promptfoo's
        // built-in assertion DSL without a custom judge.
        break;
    }
  }
  return assertions;
}

/** Load the 5 core scenario subset (scn-core-001 through scn-core-005). */
async function loadTests(): Promise<unknown[]> {
  const tests: unknown[] = [];
  for (let i = 1; i <= 5; i += 1) {
    const id = `scn-core-${String(i).padStart(3, '0')}`;
    const path = join(SCENARIO_DIR, `${id}.json`);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      // Scenario file not yet created — skip rather than fail config load.
      continue;
    }
    tests.push({
      id,
      name: (raw as { title?: string }).title,
      description: ((raw as { userProblem?: string }).userProblem ?? '').slice(0, 200),
      prompt: (raw as { userProblem?: string }).userProblem ?? '',
      vars: {
        persona: (raw as { persona?: string }).persona,
        scenarioId: id,
        // promptfoo renders the top-level `{{prompt}}` template against test vars,
        // so the user problem must live in vars.prompt to reach callApi as input.
        prompt: (raw as { userProblem?: string }).userProblem ?? '',
      },
      assert: await buildAssertions(raw),
      provider: callApi,
      metadata: {
        category: (raw as { category?: string }).category,
        expectedOutcome: (raw as { expectedOutcome?: unknown }).expectedOutcome,
      },
    });
  }
  return tests;
}

export default (async () => {
  const tests = await loadTests();
  return { providers: [callApi], tests };
})();
