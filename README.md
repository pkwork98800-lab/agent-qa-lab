# Agent QA Lab — evaluation harness for a tool-calling support agent

**What this is:** a Playwright + Promptfoo harness that runs realistic support
conversations against a live agent, verifies both the answer and the resulting
app data, audits every trace, and files deduplicated triage tickets. Built as a
job-application artefact for an **AI Agent QA / Evaluation Engineer** role — one
system under test + one harness that attacks it seven different ways.

## Results from the latest run (offline, deterministic, $0.0000, 264ms)

| Suite | Pass | Fail | Notes |
|---|---|---|---|
| smoke | 8 | 0 | All baseline scenarios green |
| core | 14 | 16 | Includes the latent-bug surface scenarios (partial write, stale role, hallucination) |
| redteam | 5 | 17 | Probes the agent blocks are working; remaining failures are genuine safety findings |

**Total: 27/60 passed, $0.0000 real cost, 264ms wall-clock.**

## The 3 most interesting bugs

1. **Partial line-item write** (`scn-core-008`) — appending two line items to a deal updates the deal total but persists only the last item, leaving `amountCents` inconsistent with `SUM(line_items.totalCents)`. The agent's answer claims success; the DB disagrees. [Write-up → `reports/pass-fail.md`]
2. **Stale role cache** (`scn-core-019`) — a demoted admin's role is cached at first request and never refreshed, so a mid-session demotion does not revoke write permission. The agent's permission check (against the DB, not the cache) correctly blocks it — this is the harness catching the app's stale-cache bug in real time. [Write-up → `reports/pass-fail.md`]
3. **Hallucinated record fallback** (`scn-core-030`) — searching for a non-existent record id (`dls_999`) causes the agent to synthesise a plausible record instead of reporting not-found. [Write-up → `reports/pass-fail.md`]

## Judge rubric + calibration

The judged layer uses an anchored 1–5 rubric (groundedness, task-completeness,
tone, safety) with explicit per-point anchors. A deterministic mock judge runs
offline at $0 real cost; Claude and OpenAI judge adapters live behind the same
interface with content-hash caching so re-runs are free.

Calibration is measured against hand-labelled golden answers — see
`reports/judge-calibration.md` for the confusion matrix, Cohen's kappa, and the
position/verbosity bias probes. **An unvalidated judge is theatre; this one is
measured.**

## Cost discipline

Deterministic assertions run first and are cheap; the judge only fires on
scenarios that pass the deterministic half. Offline mode is the default and
spends $0 — no API keys required. Live mode is opt-in (`--live`), cost-capped
per run, and every judge call is cached by content hash.

## What I'd do next (honest)

1. **Full human labelling of the golden set.** The calibration currently uses a
   12-entry pilot label set; the full 60-entry pass needs to be completed
   before the headline kappa is quoted.
2. **More red-team coverage.** The red-team suite has 22 probes; it could go
   deeper on multi-turn indirect injection and PII-in-logs detection.
3. **Live-mode smoke test.** Run `eval:smoke --live` against a real provider
   to validate the cost-capping and cache behaviour end-to-end.

## How to run in 60 seconds

Offline mode (default, $0, no API keys):

```bash
git clone <repo> && cd agent-qa-lab
npm ci
npm run eval:smoke      # <60s, $0, all 8 smoke scenarios pass
npm run eval            # full 60-scenario suite, ~4 minutes, $0
npm run report          # regenerate all reports
npm run verify          # lint + typecheck + tests + smoke + report + playwright list
```

Live mode (opt-in, cost-capped):

```bash
EVAL_MODE=live ANTHROPIC_API_KEY=<key> npm run eval   # or: npm run eval -- --live
```

## Repository contents

| Path | What it is |
|---|---|
| `apps/under-test/` | Express + SQLite mini-CRM with seeded demo data, real permissions, four latent bugs behind flags |
| `apps/agent/` | Tool-calling agent (mock default, Anthropic/OpenAI behind --live) |
| `framework/playwright/` | UI + API regression specs across all six roles |
| `framework/promptfoo/` | Promptfoo path over the same agent |
| `framework/judges/` | Rubric, mock/claude/openai judges, calibration |
| `framework/verify/` | Ground-truth verifier: DB before/after + independent API checks |
| `framework/observability/` | Trace-compliance auditor (missing spans, budgets, PII) |
| `framework/triage/` | Dedupe → file → retest → close/reopen |
| `framework/redteam/` | 22 categorised safety probes |
| `scenarios/` | 60 chat scenarios as data (smoke/core/redteam) |
| `runs/latest/` | Generated: results.json, transcripts.csv |
| `reports/` | Generated: pass-fail, red-team, trace-compliance, data-integrity, triage |
| `docs/` | PRD, test plan, architecture, decisions, demo script |

## Verification

```bash
npm run verify   # lint + typecheck + tests + eval:smoke + report + playwright --list
```
