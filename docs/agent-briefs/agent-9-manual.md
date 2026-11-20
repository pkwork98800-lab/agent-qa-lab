# Agent 9 — The manual half (PRD, test plan, app map, exploratory charters)

You own: `docs/PRD.md`, `docs/test-plan.md`, `docs/scenario-design-guide.md`,
`reports/manual-test-pack.md`, `reports/app-map.md`.
You do NOT own: `docs/ARCHITECTURE.md`, `docs/BUILD-CONTRACT.md`,
`docs/DECISIONS.md`, `docs/DEMO.md`, `docs/agent-briefs/**`, `package.json`,
`README.md`, `src/**`, `apps/**` (read + run only).

## Context

Read `docs/ARCHITECTURE.md` and `docs/BUILD-CONTRACT.md` §3 (the seed), then
**actually run the app** (`npx tsx apps/under-test/server.ts`, log in as each
persona via the role switcher) and explore it before writing. The plan is blunt
about this module: everyone builds automation and skips it; done properly it is
what makes the repo look like someone who has done the job. Write real prose
with real opinions, grounded in what you actually saw.

## Deliverables

### `docs/PRD.md` — 2-page product requirements doc for the mini-CRM

Written as the product spec that existed _before_ the app: goal, personas,
entities + relationships, the six user journeys, permissions model, API
surface, non-goals. It must be specific enough that a test plan can trace to
it (use requirement ids `REQ-1`…`REQ-24`).

### `docs/test-plan.md`

From the PRD, with: scope (in/out), risks with likelihood×impact, entry/exit
criteria, environments, the traceability matrix (`REQ-n` → scenario ids →
Playwright spec ids → report section), and an explicit **gap analysis** — the
cases the PRD did not name, each marked `GAP-n` with why it matters (e.g.
concurrent edits, outbox retry, currency rounding, deleted-mid-conversation
records). The plan's target: at least 9 gap cases.

### `reports/app-map.md`

One Mermaid diagram mapping screens (the /ui routes), roles (the six personas),
entities (the nine tables) and the API surface, plus short prose on how a new
engineer orients in the product in ten minutes. Verify the Mermaid renders
(well-formed, quoted labels where needed).

### `reports/manual-test-pack.md`

The pack itself:

- **10–15 session-based exploratory charters**, each: charter statement,
  time-box (30–60 min), persona/role, starting point, what you did (real
  steps), observations, bugs/issues found (id + severity + one-line repro),
  and a "next session" note. At least 4 charters must report a real finding
  against the app (they can — the app has real latent bugs; explore for them:
  permissions, line items, email, role changes).
- A **bug list** summarising the charter findings with severity and status.
- A short **heuristics applied** section (SFDPOT, goldilocks, CRUD, etc.) —
  named, with where each was used.

### `docs/scenario-design-guide.md`

"How to write a realistic chat scenario that starts with a real problem" vs a
toy prompt: the criteria (concrete actor, real task, real data, observable
outcome, honest assertions), the anti-patterns ("hello what can you do",
"is the sky blue"), and **5 bad/good pairs** — each pair a toy version and the
realistic rewrite of the same idea, with a line on why the rewrite tests more.

## Acceptance

- Mermaid blocks: paste one rendered flow (use `npx tsx` only if you need to
  extract it from the app; the map itself is prose + diagram).
- Every bug you report must include the exact steps you used and the app state
  (seed ids). Quote real field values you observed.
- `npx prettier --check` clean on your files.

## Report

Format from `docs/agent-briefs/_common.md` §7. Known limits: state honestly if
the app was unavailable and which parts are written against the documented
contract instead of a live exploration.
