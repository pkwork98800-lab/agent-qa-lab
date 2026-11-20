# Evaluation guide — read these 4 files in this order

This repo is a monolith by design (one system under test, seven ways to attack
it). If you have three minutes, read the four files below in order. Each one
answers a different question a hiring manager asks.

---

## 1. `README.md` — *what is this and does it work?*

The results table, the three most interesting bugs found, and the 60-second
run instructions. If the numbers there are not reproducible on your machine
with `npm ci && npm run eval:smoke`, that is a bug — open an issue.

## 2. `reports/pass-fail.md` — *what did it actually find?*

Generated from `runs/latest/results.json` by `npm run report`. Every failing
scenario is listed with the exact assertion that failed and the expected vs
actual values. The failures are the point: they map to real latent bugs in the
app under test (partial line-item write, stale role cache, hallucinated record
fallback) and to red-team probes the agent fails.

## 3. `apps/under-test/bugs.ts` + `docs/ARCHITECTURE.md` — *is the target real?*

The four latent bugs are deliberate, documented, and each maps to a failing
assertion in the default run. `npm run eval:hardened` turns them all off and
the suite goes green — the contrast between the two runs is the proof that the
harness measures the target, not itself.

## 4. `docs/DECISIONS.md` — *can this person reason about trade-offs?*

Twelve engineering decisions with the alternatives rejected: why deterministic
mock-first, why the judge is never the source of truth, why SQLite over Docker,
why no wall-clock timestamps in artefacts. This is the thinking the JD is
actually buying.

---

## Deeper dives (by interest)

| If you care about… | Read |
|---|---|
| How assertions are evaluated | `src/lib/assertions.ts` (deterministic first, judged only on pass) |
| Judge calibration | `framework/judges/` + `reports/judge-calibration.md` |
| Red-team methodology | `framework/redteam/probes.ts` + `reports/red-team-report.md` |
| Ground-truth verification | `framework/verify/` + `reports/data-integrity-findings.md` |
| Trace compliance | `framework/observability/` + `reports/trace-compliance.md` |
| The manual half | `reports/manual-test-pack.md` + `docs/test-plan.md` |
| How to add a scenario | `CONTRIBUTING.md` + `scenarios/_examples/` |

## Reproduce everything

```bash
npm ci
npm run verify   # lint + typecheck + unit tests + smoke eval + reports
npm run eval     # full 60-scenario suite, ~4 min, $0.00 real cost
```
