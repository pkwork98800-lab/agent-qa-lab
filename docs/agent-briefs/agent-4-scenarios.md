# Agent 4 — Scenario suite + Promptfoo path

You own: `scenarios/smoke/**`, `scenarios/core/**`, `framework/promptfoo/**`.
You do NOT own: `scenarios/_schema.ts`, `scenarios/schema.json`,
`scenarios/_examples/**` (read-only, copy their shape),
`scenarios/redteam/**` (agent 10), `package.json`, `README.md`.

## Context

Read `docs/BUILD-CONTRACT.md` (§3 seed, §5 assertion DSL, §8 artefacts) and
study `scenarios/_examples/*.json` — six fully worked scenarios. Your job is
the flagship module: **50+ realistic chat scenarios as data**, each starting
from a genuine problem a support/sales person actually has, plus the Promptfoo
config path over the same agent.

## Deliverables

### Scenario files (one JSON file per scenario)

- `scenarios/smoke/scn-smoke-0NN.json` — 8 scenarios: the cheap CI-green
  baseline (happy paths + one refusal). All must PASS with default bug flags.
- `scenarios/core/scn-core-NNN.json` — 30 scenarios covering the categories and
  personas in the table below. Every scenario has ≥2 assertions including ≥1
  `llm-rubric` (the plan's rule: every scenario has both layers), a `trace`
  block, a `rationale`, and ≥2 tags.
- Ids are unique and sequential (`scn-core-001`…), validated against
  `scenarios/_schema.ts` (`parseScenario`).
- Persona coverage across the suite: all six of `owner_emma, manager_viktor,
rep_liam, support_sofia, auditor_raul, contractor_dana` appear at least
  twice.
- Assertions must reference real seed ids (`con_001`, `dls_002`, …). A scenario
  is **fair** iff a correct agent passes it — verify via the gate below.

Core-suite coverage plan (30): lookup 7, create-record 5, update-record 5,
permission 5, communication 4, multi-step 3, hallucination 1. Include the
scenarios that target the latent bugs (line-item append, stale-role demotion
mid-session, hallucinated id `dls_999`, email PII guardrail) — these are
allowed to FAIL in a default run; they are the genuine findings. Every failing
scenario must have a `rationale` naming the bug surface it probes.

### `framework/promptfoo/promptfooconfig.ts` (ESM TypeScript config)

Promptfoo 0.119 supports a TS/ESM config file. It must:

- Define one `provider` — `framework/promptfoo/provider.ts` exporting
  `callApi(prompt, context)` which calls the SAME agent entry point
  (`runChat` from `apps/agent/index.ts`) against a locally booted app and
  returns `{ output: finalAnswer, metadata: { toolsCalled, dbDiff, spans,
scenarioId } }` as JSON.
- `tests: []` loaded dynamically from `scenarios/core/scn-core-00[1-5].json`
  (a fixed 5-scenario subset — the full suite is the native runner's job).
- `assert` blocks using the repo's custom JS assertions below.

### `framework/promptfoo/assertions/*.js` (plain ESM JavaScript)

Custom promptfoo assertions as exported functions (promptooconfig references
them via `file://` or module path per its docs):

- `assertToolsCalled.js` — deterministic: expected tool names appear in
  `metadata.toolsCalled` in order.
- `assertNoToolCalled.js`, `assertDbConsistent.js` (line items sum to deal
  total), `assertNoPiiInOutbound.js` (outbox scan with the default patterns).
  Each takes `(output, { vars, provider })`-style promptfoo signature and returns
  `{ pass, score, reason }`.

### `framework/promptfoo/README.md`

How to run (`npm run eval:promptfoo`), what it proves (the same agent is
exercisable through a third-party eval framework, not just our runner), and its
limits (subset of scenarios; no DB snapshot/restore between cases).

## Acceptance (run these, paste output)

Once the orchestrator tells you the runner exists (`npm run eval`):

```bash
npm run eval:hardened     # your smoke + core scenarios must ALL pass
npm run eval:smoke        # must pass
npm run eval              # note which scenarios fail — every failure must map
                         # to a documented latent bug, list them in your report
npm run eval:promptfoo    # 5-scenario subset through promptfoo, exit 0
```

Until the runner exists, validate every file with
`npx tsx -e "import {parseScenario} from './scenarios/_schema.ts'; ..."` over
your files and report that result; the orchestrator will re-verify fairness at
integration.

## Report

Format from `docs/agent-briefs/_common.md` §7. Include the pass/fail counts per
category from `npm run eval:hardened` and the list of intentional failures
from `npm run eval` mapped to bug flags.
