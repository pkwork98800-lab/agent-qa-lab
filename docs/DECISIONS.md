# Engineering decisions

Each entry is a real trade-off taken during this build, with the alternative
that was rejected. Written for the reader who asks "why is it built this way?".

## D1 — One repo, seven modules, not seven repos

The plan's core bet: the modules share one system under test so every artefact
is evidence about the _same_ target. Seven repos would show tool knowledge; one
repo shows judgement. Rejected: per-tool tutorial repos (the exact anti-pattern
in the plan §12).

## D2 — Deterministic-first, offline by default, $0 per run

`npm run eval` runs against a deterministic mock LLM provider. Rationale: a QA
harness that needs an API key and $1 per run cannot gate CI, cannot be re-run
by a reviewer, and cannot prove byte-identical reproducibility. Live providers
(Anthropic/OpenAI) are real code paths behind `--live` with a hard cost ceiling.
The mock provider is a documented rules engine (`apps/agent/providers/mock.ts`),
not a random stub — it has genuine, debuggable behaviour so failures are real
failures of the pipeline, not noise.
Rejected: live-only eval (fails the "hiring manager can run it in 3 minutes"
requirement).

## D3 — Judged layer is never the source of truth for correctness

Deterministic assertions run first and are cheap; the judge only fires on
scenarios that pass the deterministic half, and only scores the natural-language
answer. A judge verdict can never turn a wrong DB write into a pass. This is the
"the judge is not the source of truth" principle and it also cuts cost.
Rejected: judge-everything (theatre, and expensive).

## D4 — Judge calls cached by content hash

Live-mode judge calls are cached on `sha256(scenario + answer + rubric + model)`.
Re-runs are free and a reviewer can reproduce the exact judgment. Offline mode
has no network calls at all.

## D5 — SQLite + Express mini-CRM rather than ERPNext/Odoo Docker

The plan offers ERPNext/Odoo via Docker. Rejected for the default path: Docker
adds a 30-minute setup for the reader and snapshot/restore becomes a
volume-management problem. A real SQLite schema with the same _shape_ (contacts,
companies, deals with line items, invoices, activities, roles) gives the
verifier something genuine to diff and boots in milliseconds. The verifier's
checks (field-level diff, consistency invariants, role matrix) are the artefact;
they port to any ORM-backed app.
Rejected: Docker-required path (fails "open and evaluate in 3 minutes").

## D6 — Demo-grade auth via `x-actor-id` header

A real OIDC flow adds no QA signal and hours of flake. The header is documented,
enforced (401 on unknown), and the permission matrix is real data. This trades
auth realism for test clarity — the right trade for a portfolio whose subject is
_agent_ QA, not auth QA.
Rejected: full OIDC (scope creep, flake, zero new signal).

## D7 — Latent bugs are ON by default, with a `--hardened` switch to prove the harness

The app ships four realistic latent bugs behind feature flags
(`apps/BUGS.md`). A harness that finds them is credible; a harness that finds
nothing is either useless or untested. `npm run eval:hardened` disables all
four and the suite goes green — that contrast is the proof the harness measures
the target and not itself. Every failed assertion in a default run maps to a
documented bug with a flag.

## D8 — No wall-clock timestamps in generated artefacts

Offline runs regenerate byte-identically, so nothing generated may embed a
clock. Run identity is a content hash (`RunMetadata.runId`), dates live only in
hand-maintained prose (README), and generated reports state the run id instead.
Rejected: pretty timestamps (breaks the reproducibility claim).

## D9 — Prompts configs live as data; promptfoo runs the same agent

`framework/promptfoo` wraps the same `runChat` entry point as the native
runner, so both paths exercise one agent, not two. Promptfoo is the secondary
(path-demonstrating) runner; the native runner owns the pipeline because it
needs DB snapshots, trace emission and triage in one pass.

## D10 — Package.json owned by the orchestrator during the build

Ten parallel agents writing one manifest corrupts the lockfile and the script
table. Sub-agents request scripts/dependencies in their reports instead. This is
a build-time deviation from the roster in `docs/BUILD-CONTRACT.md` §1 and is
recorded here deliberately.

## D11 — Mock token counts are labelled estimates

In offline mode the mock provider reports deterministic token estimates
(chars/4). They exist so budget assertions and cost-shape tests are meaningful;
they are labelled as estimates wherever shown and never presented as measured
spend. Offline real spend is $0.

## D12 — Triage is a script, not a service

The JD asks for dedupe → file → retest → close/reopen. That is a batch decision
engine over run artefacts plus a Linear client, not a daemon. Fixture mode
(recorded open tickets, clearly labelled) is the default; `--live` needs a
Linear key.
