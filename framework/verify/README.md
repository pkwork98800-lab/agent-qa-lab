# framework/verify — ground-truth verifier (agent 6)

## What it does

Answers the central QA question: **after the chat, is the app data actually
correct — every field, not just "a row was created"?**

Given a `RunResult` (with `dbBefore`/`db_after` snapshots), the verifier:

1. **Diff audit** (`diff-audit.ts`): turns `diffSnapshots(dbBefore, dbAfter)`
   into field-level findings (every added / removed / changed row), then runs
   cross-field consistency checks over _all_ rows in `db_after`:
   - `deal-total-matches-line-items`
   - `line-items-orphan-free`
   - `invoice-balance-matches-payments`
     A mismatch is a `blocker` finding. It also detects **silent partial writes**
     (agent claimed success but fewer rows persisted than claimed) and
     **agent-claims vs data** mismatches (a field the agent set differs from what
     the DB stores).
2. **API checks** (`api-check.ts`): independent HTTP re-GET of every record the
   agent claims to have created/updated, asserting response fields match stored
   data; permission probes across roles; a cross-scope probe
   (`usr_dana` reading another company's contact → must be 404).
3. **Role matrix** (`role-matrix.ts`): the same action across all six roles,
   expected vs actual, plus a mid-matrix demotion of `usr_viktor` that surfaces
   the stale-role-cache bug.
4. **Report** (`report.ts`): `generateDataIntegrityReport` writes
   `reports/data-integrity-findings.md` with a one-line summary, before/after
   field tables, the role matrix, and curl reproduction commands.

## How to run alone

Boot the app under test, then run the CLI:

```bash
# Option A: app already running on 4799
npx tsx framework/verify/run.ts \
  --input runs/latest/results.json \
  --base-url http://127.0.0.1:4799 \
  --out reports/data-integrity-findings.md

# Option B: no --base-url — the CLI boots its own app server (imports
# startServer from apps/under-test) and tears it down on exit.
npx tsx framework/verify/run.ts \
  --input runs/latest/results.json \
  --out reports/data-integrity-findings.md
```

## Inputs

`--input` is a JSON file containing `RunResult[]` (see
`src/contracts/types.ts`): each entry needs `scenarioId`, `persona`,
`dbBefore`, `dbAfter`, `toolsCalled`, `finalAnswer`.

`--base-url` is the app under test (default port 4799). Required for live API
checks; omitted → the CLI boots its own server.

## Outputs

- `--out` markdown report: one-line summary, per-scenario status/findings
  table, before/after field tables for failing scenarios, role matrix, and curl
  reproduction commands.
- Console summary: runs verified / passed / failed / blocker findings.

## Offline vs live

- **Offline (always works):** diff + snapshot audits run from `dbBefore`/
  `dbAfter` alone — no server needed.
- **Live (explicit):** API re-GET, permission probes, cross-scope 404 and the
  role matrix require a booted app at `--base-url`.

## Files

| File             | Purpose                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`       | Frozen surface: `verifyRun`, `generateDataIntegrityReport`, `VerifyOutcome`, `Finding`, `ApiCheckResult`, `RoleMatrixRow` |
| `diff-audit.ts`  | Snapshot diff → findings + cross-field checks + partial-write + claims-vs-data                                            |
| `api-check.ts`   | Independent API re-GET, permission probes, cross-scope 404                                                                |
| `role-matrix.ts` | Same action as 6 roles → expected vs actual, mid-matrix demotion                                                          |
| `report.ts`      | `generateDataIntegrityReport` → `reports/data-integrity-findings.md`                                                      |
| `run.ts`         | CLI: `--input` `--base-url` `--out`                                                                                       |
| `README.md`      | This file                                                                                                                 |

## Determinism

No wall-clock timestamps are emitted. Ordering is by id, not time.
