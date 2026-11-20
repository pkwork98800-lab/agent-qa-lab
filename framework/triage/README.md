# framework/triage — Triage bot (dedupe → file → retest → close/reopen)

Owned by agent 8. Writes only inside `framework/triage/**`. Triage is a
**script, not a service**: a decision engine over run artefacts plus a Linear
client. Offline/fixture mode works with no keys; live mode is behind `--live`.

## What it does

1. **Normalise** (`normalise.ts`): assigns each `TicketCandidate` a stable
   signature `scenarioId|source|errorClass` and an imperative title naming the
   component and the observable failure.
2. **Dedupe** (`index.ts` + `similarity.ts`): matches candidates against open
   tickets (fixture backlog + state workspace) by exact signature and by
   title+signature similarity (`0.6 × jaccard + 0.4 × levenshteinRatio`,
   threshold `0.72`). Matches become `duplicate`; everything else is `new`.
3. **Retest** (`retest.ts`): applies the state machine to `new` candidates —
   `fixed` → `closed`, `still-failing` → `reopened`, no entry → stays `new`.
   Duplicates keep their state (evidence is appended to the matched ticket,
   never a new ticket).
4. **Report** (`report.ts` / `generateTriageSummaryMarkdown`): writes
   `reports/triage-summary.md` with the headline new/dupes/closed/reopened
   table, per-decision sections with rendered ticket bodies, and a dedupe
   similarity table.
5. **Linear** (`linear.ts`): real GraphQL client
   (`https://api.linear.app/graphql`, `Authorization` from `LINEAR_API_KEY`).
   Fixture mode applies state transitions to
   `framework/triage/state/tickets-state.json`. Without a live key, throws
   `MissingLinearKeyError`.

## Files

| File                                 | Purpose                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `index.ts`                           | `triageCandidates()` + `generateTriageSummaryMarkdown()` — frozen surface      |
| `normalise.ts`                       | `normalise()`, `signatureFor()`, `titleFrom()`, `errorClassFor()`              |
| `similarity.ts`                      | `tokenSet()`, `jaccard()`, `levenshtein()`, `similarity()`, `DEDUPE_THRESHOLD` |
| `tickets.ts`                         | `renderTicketBody()` — strict Linear markdown ticket template                  |
| `linear.ts`                          | `LinearClient` — GraphQL client + fixture-mode state machine                   |
| `retest.ts`                          | `retestCandidates()` — fixed→closed, still-failing→reopened                    |
| `run-triage.ts`                      | CLI: `--input --retest --out [--live]`                                         |
| `fixtures/open-tickets.fixture.json` | 12 realistic open tickets (≥3 near-dupes)                                      |
| `state/tickets-state.json`           | fixture-mode workspace (generated)                                             |
| `README.md`                          | this file                                                                      |

## How to run alone

Fixture mode (default, no keys):

```bash
npx tsx framework/triage/run-triage.ts \
  --input <candidates.json> \
  --retest <retest.json> \
  --out reports/triage-summary.md
```

Live mode (requires `LINEAR_API_KEY`):

```bash
LINEAR_API_KEY=<key> npx tsx framework/triage/run-triage.ts \
  --input <candidates.json> \
  --retest <retest.json> \
  --out reports/triage-summary.md \
  --live
```

## Inputs

- `--input`: JSON array of `TicketCandidate` objects (see
  `src/contracts/types.ts`).
- `--retest` (optional): JSON map `signature → 'fixed' | 'still-failing'`,
  produced by the orchestrator re-running failed scenarios.

## Outputs

- `--out`: markdown triage summary (headline, per-decision sections, dedupe
  table).
- `framework/triage/state/tickets-state.json`: fixture-mode workspace
  (created on first run).

## Verification

`npx tsc --noEmit`, `npx eslint framework/triage --max-warnings 0`,
`npx prettier --check framework/triage`.
