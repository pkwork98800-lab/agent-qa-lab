# framework/promptfoo — Promptfoo eval path for agent-qa-lab

## What it does

Exercises the same system-under-test agent (`runChat` from `apps/agent/index.ts`)
through [promptfoo](https://promptfoo.dev) (v0.119), a third-party eval
framework. This proves the agent is exercisable through an external harness,
not just the native `scripts/run-eval.ts` runner.

## How to run alone

```bash
# From the repo root:
npm run eval:promptfoo
```

Which expands to:

```bash
promptfoo eval -c framework/promptfoo/promptfooconfig.ts
```

## What it outputs

Promptfoo writes results to `./promptfoo-results/` (or the location configured
in promptfoo's default output). Each test case shows pass/fail per assertion,
with the provider's `metadata` (toolsCalled, spans, scenarioId) attached.

## Inputs

- `framework/promptfoo/provider.ts` — promptfoo provider that calls `runChat`
  against the locally booted app on `http://127.0.0.1:4799`.
- `framework/promptfoo/assertions/*.js` — four custom JS assertions:
  - `assertToolsCalled.js` — expected tool names appear in order
  - `assertNoToolCalled.js` — a named tool must not appear
  - `assertDbConsistent.js` — deal total equals sum of line items
  - `assertNoPiiInOutbound.js` — outbox contains no PII patterns
- `scenarios/core/scn-core-00[1-5].json` — five core scenarios loaded
  dynamically as promptfoo tests.

## Limits

- **Subset only**: the first 5 core scenarios (scn-core-001 through scn-core-005).
  The full 38-scenario suite (8 smoke + 30 core) runs via `npm run eval:hardened`
  and `npm run eval:smoke` through the native runner.
- **No DB snapshot/restore between cases**: promptfoo runs each test against a
  live app without resetting the DB first, so state can leak between cases.
  `dbDiff` is not populated by the provider.
- **`runChat` not yet implemented**: `apps/agent/index.ts` (agent 2 ownership)
  does not export `runChat` in this snapshot. Until agent 2 delivers it,
  `npm run eval:promptfoo` cannot execute against a real agent. This is a
  tracked dependency, not a defect in this module.
- **Not all scenario assertions map to promptfoo**: `llm-rubric`,
  `trace-shape`, `db-field-equals`, `api-response-matches`, and
  `permission-outcome` assertions from scenario files are not converted to
  promptfoo assertions in this config. They are exercised by the native runner.

## Dependencies

- `promptfoo` (devDependency, already installed at ^0.119.0)
- `apps/agent/index.ts` exporting `runChat` (agent 2 — not yet delivered)
