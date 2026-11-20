# Agent 6 — Ground-truth verifier (API + DB)

You own: `framework/verify/**`.
You do NOT own: `package.json`, `src/contracts/**` (read-only), `src/lib/**`
(read + use), `apps/**` (read + call over HTTP), `scripts/**`.

## Context

Read `docs/BUILD-CONTRACT.md` (§3 seed, §5, §7) and `src/contracts/types.ts`
(`RunResult`, `DbSnapshot`, `DbDiff`). This module answers the JD's central
question: _after the chat, is the app data actually correct — every field, not
just "a row was created"?_

## Deliverables

### `framework/verify/index.ts` — the frozen surface

```ts
export function verifyRun(
  run: RunResult,
  ctx: { baseUrl: string; actorId: string },
): Promise<VerifyOutcome>;
export function generateDataIntegrityReport(
  outcomes: VerifyOutcome[],
  outPath: string,
): Promise<void>;
export interface VerifyOutcome {
  scenarioId: string;
  status: 'pass' | 'fail';
  findings: Finding[];
  dbDiff: DbDiff;
  apiChecks: ApiCheckResult[];
  roleMatrix: RoleMatrixRow[];
}
export interface Finding {
  id;
  scenarioId;
  kind;
  severity;
  expected;
  actual;
  evidence;
}
```

### `framework/verify/diff-audit.ts`

Turn `diffSnapshots(run.dbBefore, run.dbAfter)` (from `src/lib/diff.ts`) into
findings:

- Every changed/added/removed row is reported with the field-level detail.
- Cross-field checks over `db_after`: `deal-total-matches-line-items` (all
  deals, not just the scenario's), `line-items-orphan-free`,
  `invoice-balance-matches-payments`. Mismatch → finding, severity `blocker`,
  evidence = the exact numbers ("dls_006 amountCents=80000 but
  SUM(totalCents)=64000; line item dli_019 missing").
- **Silent partial write detection**: a run where the agent claimed success
  (final answer asserts the write) but the diff shows the claimed rows missing
  or a total inconsistent → `blocker` finding quoting the answer vs the diff.
- **Consistency of agent claims vs data**: for update scenarios, a field the
  agent named in its answer that differs in the DB → finding.

### `framework/verify/api-check.ts`

Independent API assertions — bypassing the agent entirely:

- Re-`GET` every record the agent claims to have created/updated, assert the
  response fields (this is what catches a UI-only or cache-only bug).
- Permission probes: for a sample of role×action pairs, call the API with the
  right `x-actor-id` and assert allow/deny per the BUILD-CONTRACT §3 matrix.
- Cross-scope probe: `usr_dana` GETs another company's contact → must be 404.

### `framework/verify/role-matrix.ts`

The "same action as 5 roles → 5 expected outcomes" test, run as data: a table
of `{ action, resource, expected: { owner: 'allow', admin: 'allow',
sales_rep: 'allow', support_agent: 'deny', read_only: 'deny', external: 'deny' } }`
executed against the live API. The stale-role bug shows up here as a
mismatch after a mid-matrix demotion — include one row that demotes
`usr_viktor` mid-run and re-checks.

### `framework/verify/report.ts`

`generateDataIntegrityReport` writes `reports/data-integrity-findings.md`:

- One-line summary a non-QA reader can act on (e.g. "2 of 38 scenarios left
  the CRM in an inconsistent state; both are the same partial-write bug").
- A before/after table per failing scenario (table, row id, field, before,
  after, mismatch highlighted with `**` markers in markdown).
- The full role matrix table with expected vs actual.
- A "how to reproduce" section per finding (exact curl commands).

### `framework/verify/run.ts` (CLI)

`npx tsx framework/verify/run.ts --input runs/latest/results.json --base-url
http://127.0.0.1:4799 --out reports/data-integrity-findings.json` — boots its
own app server if `--base-url` is omitted (import `startServer` from
`apps/under-test`).

### `framework/verify/README.md`

What it does, how to run alone, inputs, outputs.

## Acceptance (run these, paste output)

Build a small input fixture by hand-or-from-a-live-run: run 3 scenarios
against a booted app (use `apps/agent`'s `runChat`), save `RunResult[]` JSON,
then:

```bash
npx tsx framework/verify/run.ts --input <fixture> --out /tmp/verify.json
```

Paste the report's summary section and show at least one real before/after
field table (from the partial-write scenario if the app is ready).

## Report

Format from `docs/agent-briefs/_common.md` §7. Known limits: state which checks
need a live server vs run from snapshots alone.
