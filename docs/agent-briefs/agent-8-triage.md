# Agent 8 — Triage bot (dedupe → file → retest → close/reopen)

You own: `framework/triage/**`.
You do NOT own: `package.json`, `src/contracts/**` (read-only), `src/lib/**`,
`apps/**`, `scripts/**`.

## Context

Read `docs/BUILD-CONTRACT.md` (§7, §8, §9) and `src/contracts/types.ts`
(`TicketCandidate`, `TriageDecision`, `TriageSummary`). The JD: _"File clear
tickets that name the environment and include proof. Remove duplicates first,
then retest and close or reopen each ticket."_ Triage is a **script, not a
service** (D12) — a decision engine over run artefacts plus a Linear client.

## Deliverables

### `framework/triage/index.ts` — the frozen surface

```ts
export function triageCandidates(
  candidates: TicketCandidate[],
  opts: {
    mode: 'fixture' | 'live';
    statePath: string;
    retest?: Record<string, 'fixed' | 'still-failing'>;
  },
): Promise<TriageSummary>;
export function generateTriageSummaryMarkdown(
  summary: TriageSummary,
  outPath: string,
): Promise<void>;
```

### `framework/triage/normalise.ts`

`normalise(candidate)` → stable signature: sorted `scenarioId + '|' +
assertionType + '|' + errorClass`. Error class from the failure message
(`missing-span`, `field-mismatch`, `permission-leak`, `hallucination`,
`partial-write`, `other`). Also `titleFrom(candidate)`: imperative, names the
component and the observable ("verify: send_email runs emit no guardrail span").

### `framework/triage/similarity.ts` (pure TS, no deps)

- `tokenSet(s)` → lowercase word tokens minus stopwords.
- `jaccard(a, b)`, `levenshtein(a, b)` + normalised ratio.
- `similarity(a, b) = 0.6 * jaccard + 0.4 * levenshteinRatio` over
  `title + signature` — the threshold (default 0.72) is a named constant with a
  comment explaining why not higher/lower.

### `framework/triage/tickets.ts`

- Strict ticket template (Linear markdown body): `## Environment`, `## Severity`,
  `## Repro`, `## Expected`, `## Actual`, `## Evidence` (report path, assertion
  ids, transcript row, trace id, cost), `## Labels`. Render from a
  `TicketCandidate`.
- `framework/triage/fixtures/open-tickets.fixture.json` — 12 realistic open
  tickets with `{"fixture": true, "note": "recorded shape of a real backlog;
synthetic content, labelled"}` header. At least 3 must be near-duplicates of
  the candidates produced by the demo failures so dedupe is demonstrated on
  real inputs.

### `framework/triage/linear.ts`

Real Linear GraphQL client (`https://api.linear.app/graphql`, `Authorization`
from `LINEAR_API_KEY`, `requireLiveKey` when missing): `createIssue`,
`addComment`, `searchIssues` (for live dedupe), `transitionIssue`
(fixed→done with proof comment, still-failing→reopened comment). Without keys:
throws the clear error. Fixture mode applies the same state transitions to
`framework/triage/state/tickets-state.json` (a local JSON "workspace").

### `framework/triage/retest.ts`

Given `retest: Record<signature, 'fixed'|'still-failing'>` (the orchestrator's
runner re-runs failed scenarios and produces this), apply the state machine:

- `fixed` → close: state `closed`, comment with the proof (assertion ids now
  passing + run id).
- `still-failing` → reopen: state `reopened`, comment with new evidence.
- no retest entry → `blocked` (label `needs-retest`).
  Signature matching against open tickets decides `new` vs `duplicate`;
  duplicates get a comment with the new evidence appended, never a new ticket.

### `framework/triage/report.ts`

`generateTriageSummaryMarkdown` writes `reports/triage-summary.md`: the
`new: 4, dupes merged: 7, closed: 3, reopened: 1` headline table, one section
per decision with the ticket body rendered, and the dedupe similarity table
(showing which candidates matched which ticket at what score).

### `framework/triage/run.ts` (CLI)

`npx tsx framework/triage/run-triage.ts --input runs/latest/tickets.json
--retest runs/latest/retest.json --out reports/triage-summary.md` (fixture mode
default; `--live` requires the key).

### `framework/triage/README.md`

What it does, how to run alone, inputs, outputs.

## Acceptance (run these, paste output)

Build 5 hand-written `TicketCandidate`s (2 of them near-duplicates of fixture
tickets, 1 already-fixed, 1 still-failing, 1 new), write a `retest.json`, then:

```bash
npx tsx framework/triage/run-triage.ts --input <candidates.json> --retest <retest.json> --out /tmp/triage.md
```

Paste the headline `new/dupes/closed/reopened` line and the dedupe table.

## Report

Format from `docs/agent-briefs/_common.md` §7.
