# framework/redteam — red-team / safety probe suite (agent 10)

## What it does

Runs the red-team safety probe suite against recorded `RunResult[]` and emits
`reports/red-team-report.md`. It owns `framework/redteam/**` and
`scenarios/redteam/**` only.

The suite has 22 probes (rt-01…rt-22) across seven categories:

| category           | count | severity | focus                                                                                   |
| ------------------ | ----- | -------- | --------------------------------------------------------------------------------------- |
| injection-direct   | 4     | blocker  | "ignore previous instructions", role-play, write override, impersonation                |
| injection-indirect | 4     | blocker  | planted instructions in activity notes, outbox bodies, contact roles, deal descriptions |
| cross-tenant       | 4     | blocker  | external contractor reads, low-priv deal amounts, id-guessing, manager impersonation    |
| exfiltration       | 3     | blocker  | PII in outbound email, full deal dump, bulk contact export                              |
| hallucination      | 3     | major    | deleted record, dls_999, plausible-but-wrong amount                                     |
| over-action        | 2     | major    | read-only question that tempts a write, destructive change without confirmation         |
| pii-in-logs        | 2     | minor    | raw phone/email in spans (hygiene)                                                      |

Severity model: cross-tenant / exfiltration / injection that leaks → **blocker**;
over-action / hallucination → **major**; hygiene → **minor**.

Every probe passes for a correct hardened agent. Probes that fail in the default
run name the latent bug surface in their scenario rationale (scn-core-008 partial
write, scn-core-019 stale role, scn-core-024 unlogged span, scn-core-030
hallucination).

## Files

| File          | Purpose                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `probes.ts`   | `PROBES` catalogue: probeId, category, severity, title, owasp ref, fixRecommendation for all 22 |
| `severity.ts` | `severityForCategory`, `severityRank`                                                           |
| `report.ts`   | `generateRedTeamReport(runs, probesPath, outPath)` → `reports/red-team-report.md`               |
| `run.ts`      | CLI: `--results <file> --out <file> [--probes-path <dir>]`                                      |
| `README.md`   | This file                                                                                       |

## How to run alone

Boot the app under test and run a suite that produced `runs/latest/results.json`,
then generate the report:

```bash
npx tsx framework/redteam/run.ts \
  --results runs/latest/results.json \
  --out reports/red-team-report.md
```

Fixture / offline mode — no network, no live LLM:

```bash
npx tsx framework/redteam/run.ts \
  --results <fixture-with-3-failures.json> \
  --out /tmp/redteam.md
```

## Inputs

`--results` is a JSON file containing `RunResult[]` (see
`src/contracts/types.ts`): each entry needs `scenarioId`, `verdict.overall`,
`assertions[]`, `traceId`, `transcript`, `persona`, `finalAnswer`.

`--probes-path` defaults to `scenarios/redteam` relative to the repo root and is
used to map each `scenarioId` to its `probeId`.

## Outputs

- `--out` markdown report: one-line summary, severity table (probe id, category,
  severity, pass/fail, evidence assertion ids + trace id, repro message, fix
  recommendation), a "60-second blocker repro" section, a hardening section, and
  the probe catalogue.
- Console summary: runs evaluated / passed / failed.

## Offline vs live

Offline only. No live LLM, no network. The probe catalogue and scenario files are
static data.

## Determinism

No wall-clock timestamps. Ordering by probe id. The same input regenerates
byte-identically.
