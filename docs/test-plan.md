# Test plan — Mini-CRM system under test

**Sources:** `docs/PRD.md` (REQ-1…REQ-24), `docs/BUILD-CONTRACT.md` §3 seed contract, `docs/ARCHITECTURE.md`, live exploration of `apps/under-test` on `http://127.0.0.1:4799`.  
**Spelling:** British in prose; standard API/technical terms unchanged.

## 1. Scope

**In scope**

- All 24 PRD requirements traced to scenarios, Playwright specs, and report sections (§6).
- The four latent bugs shipped ON by default: `BUG_STALE_ROLE_CACHE`, `BUG_PARTIAL_LINE_ITEM_WRITE`, `BUG_HALLUCINATED_FALLBACK`, `BUG_UNLOGGED_TOOL_SPAN` (the last implemented in `apps/agent`).
- Permission matrix behaviour across all six roles, including `own`/`team`/`company` scoping and the `*` wildcard fallback.
- Data consistency invariants: deal total = sum of line items; invoice balance = amount − paid; no orphan line items.
- Outbox behaviour: send creates a row, PII patterns are not leaked, reads are scoped.
- Admin endpoints: demote/promote, reset, snapshot/restore, bug-flag toggle, `/health`.
- Server-rendered `/ui` permission-aware rendering (role switcher, create form hidden for read_only).
- The `eval:hardened` run (all four bug flags OFF) must go green — evidence the harness measures the agent, not itself.

**Out of scope**

- Real OIDC/OAuth (demo `x-actor-id` header is a documented trade-off).
- Multi-tenancy beyond seeded company/team scopes.
- File attachments, API versioning, SPA frontend, scheduling, reporting exports.
- Performance/load testing beyond the per-run `latency-budget` and `cost-budget` assertions.

## 2. Risks (likelihood × impact, 1–5)

| Risk                                                                                               | L   | I   | Score | Mitigation                                                                                   |
| -------------------------------------------------------------------------------------------------- | --- | --- | ----- | -------------------------------------------------------------------------------------------- |
| Stale role cache lets a demoted admin keep admin rights mid-session (BUG_STALE_ROLE_CACHE)         | 4   | 5   | 20    | `permission-outcome` assertions; scenario scn-core-019; charter M-02.                        |
| Partial line-item write drops items but still updates the deal total (BUG_PARTIAL_LINE_ITEM_WRITE) | 4   | 5   | 20    | `db-consistency deal-total-matches-line-items`; scenario scn-core-008; charter M-05.         |
| Id-like search invents a record instead of returning none (BUG_HALLUCINATED_FALLBACK)              | 3   | 4   | 12    | `db-record-count`/response asserts empty; scenario scn-core-030; charter M-06.               |
| `send_email` emits no tool/PII span (BUG_UNLOGGED_TOOL_SPAN)                                       | 4   | 3   | 12    | `trace-shape email-send`; observability audit; charter M-09.                                 |
| PII leaks into outbox (other contacts' emails/phones/con_* ids)                                    | 3   | 4   | 12    | `no-pii-in-outbound`; scenario scn-core-024; charter M-09.                                   |
| External actor reads cross-tenant data                                                             | 3   | 4   | 12    | `permission-outcome` for external; scenario scn-smoke-007/scn-core-007.                      |
| Read_only actor mutates data through UI or API                                                     | 2   | 4   | 8     | UI hides create form; API returns 403/404; scenario scn-smoke-003/scn-core-018/scn-core-021. |
| Deleted-mid-conversation record (actor loses access between turns)                                 | 3   | 3   | 9     | Single-record read answers 404 out of scope; 404 hides existence.                            |
| Non-deterministic timestamps breaking snapshot diffs                                               | 2   | 3   | 6     | Logical clock (seed + 1s per write); `assertSeedConsistent`.                                 |
| Concurrent edits to the same deal line items                                                       | 2   | 4   | 8     | Last write wins; no row versioning — flagged as GAP-07.                                      |

## 3. Entry and exit criteria

**Entry criteria (all must hold)**

- `npm run typecheck`, `npm run lint`, `npm run test` pass from repo root.
- App boots on port 4799; `GET /health` returns 200 with all four bug flags `true`.
- `POST /api/v1/admin/reset` returns `{ ok: true, seeded: true }` and the seed passes `assertSeedConsistent`.
- Scenario files validate against `scenarios/schema.json`.

**Exit criteria (all must hold)**

- `eval:smoke` (bugs ON) produces deterministic results: same `runId` → same bytes, no wall-clock timestamps.
- `eval:hardened` (all flags OFF) goes green.
- Every deterministic assertion that fails files a triage candidate; judged assertions run only when all deterministic pass.
- All GAP-n cases have at least one scenario or Playwright spec mapped to them, or an explicit accepted-risk note.
- `npx prettier --check` clean on all owned `.md` files.

## 4. Environments

- Default: in-memory SQLite, port 4799, mock provider, offline mode ($0.00 spend), bugs ON.
- Hardened: `--hardened` (all four bug flags OFF) via `eval:hardened`.
- Playwright webServer on port 4731; deterministic seeding via `/api/v1/admin/reset` + `/restore`.
- Live LLM mode is opt-in only (`--live` / `EVAL_MODE=live`), cost-capped at `MAX_RUN_COST_USD` (default 2.00); offline is mandatory and always works.

## 5. Traceability matrix (REQ-n → scenario ids → Playwright spec ids → report section)

| REQ                             | Scenario ids                                   | Playwright spec ids                  | Report section             |
| ------------------------------- | ---------------------------------------------- | ------------------------------------ | -------------------------- |
| REQ-1…REQ-9 (seed data)         | scn-smoke-006, scn-core-001…007, scn-core-012  | api/crud.spec.ts                     | data-integrity-findings.md |
| REQ-10 (auth 401)               | scn-smoke-003, scn-core-020                    | api/permission-matrix.spec.ts        | trace-compliance.md        |
| REQ-11 (list/search)            | scn-smoke-001, scn-smoke-008, scn-core-001…007 | api/crud.spec.ts, ui/records.spec.ts | data-integrity-findings.md |
| REQ-12 (single read 404)        | scn-core-005 (title alias), scn-core-030       | api/crud.spec.ts                     | data-integrity-findings.md |
| REQ-13 (create)                 | scn-core-008…012                               | api/crud.spec.ts                     | data-integrity-findings.md |
| REQ-14 (update)                 | scn-core-013…016                               | api/crud.spec.ts                     | data-integrity-findings.md |
| REQ-15 (delete denied)          | scn-core-022                                   | api/permission-matrix.spec.ts        | trace-compliance.md        |
| REQ-16/17 (email outbox)        | scn-smoke-005, scn-core-023…026                | ui/outbox.spec.ts                    | data-integrity-findings.md |
| REQ-18 (deal total consistency) | scn-core-008                                   | api/consistency.spec.ts              | data-integrity-findings.md |
| REQ-19 (invoice balance)        | scn-core-012                                   | api/consistency.spec.ts              | data-integrity-findings.md |
| REQ-20 (orphan-free)            | scn-core-008                                   | api/consistency.spec.ts              | data-integrity-findings.md |
| REQ-21 (demote/promote)         | scn-core-019                                   | api/permission-matrix.spec.ts        | trace-compliance.md        |
| REQ-22 (reset/snapshot/restore) | all (pre-scenario reset)                       | api/crud.spec.ts                     | trace-compliance.md        |
| REQ-23 (/health)                | —                                              | api/crud.spec.ts                     | trace-compliance.md        |
| REQ-24 (/ui permission-aware)   | —                                              | ui/roles.spec.ts, ui/records.spec.ts | trace-compliance.md        |

## 6. Gap analysis — cases the PRD did not name

Each gap is marked `GAP-n` with why it matters.

- **GAP-01 Concurrent edits to the same deal.** Two agents appending line items to one deal in the same session: last write wins, no row versioning, no optimistic-lock error. Matters because the partial-write bug (BUG_PARTIAL_LINE_ITEM_WRITE) already corrupts totals under a single writer; concurrent writers compound silent data loss. No scenario or PRD requirement covers it.
- **GAP-02 Outbox retry / idempotency.** `POST /api/v1/emails` has no idempotency key; a retried send creates a duplicate outbox row. The agent or runner has no way to detect a resend. Not addressed by REQ-16/17 or any scenario.
- **GAP-03 Currency rounding.** `unitCents`/`amountCents` are integers, but no rule governs rounding when a future feature accepts fractional units or currency conversion. The seed is cent-exact, but the contract is silent. Matters for REQ-18 consistency if writes introduce non-integer maths.
- **GAP-04 Deleted-mid-conversation records.** A record the agent acts on in turn 2 could be deleted (or the actor demoted) between turns. Single-record reads return 404 out of scope, but the agent's behaviour on a mid-turn revocation is unspecified — does it re-search, refuse, or hallucinate? scn-core-019 touches demotion but not mid-conversation revocation.
- **GAP-05 Search result ordering and relevance.** `matchesQuery` returns rows in id order with no ranking; an id-like query returns the exact id first only by accident. No requirement defines ordering, so a test cannot assert "the expected record appears first".
- **GAP-06 Audit trail.** Creates/updates carry `createdAt`/`updatedAt` but there is no change log (who changed what, when, from/to). `updatedAt` is overwritten on every write; history is lost. Not in REQ-1…REQ-24.
- **GAP-07 Row versioning / lost updates.** Related to GAP-01: `PATCH` has no `if-match` or version check, so two concurrent updates to the same contact silently overwrite. Not covered by any requirement or scenario.
- **GAP-08 Soft-delete vs hard-delete.** `delete` is denied for most roles and allowed in principle for owner/admin, but no delete endpoint exists in the route catalogue (only permission rows). It is unclear whether delete is intentionally unimplemented or simply unauthenticated. REQ-15 addresses permission only, not the endpoint.
- **GAP-09 Rate limiting / abuse.** `POST /api/v1/emails` and record creation have no rate limit; an agent loop could flood the outbox. `latency-budget` and `cost-budget` are per-run, not per-actor. No scenario tests it.

## 7. Environments and tools

- `npx tsx apps/under-test/server.ts` — app under test, port 4799 (default).
- `POST /api/v1/admin/reset` — deterministic re-seed before every scenario.
- `GET /api/v1/admin/snapshot` + `POST /api/v1/admin/restore` — Playwright checkpoint/restore.
- `POST /api/v1/admin/bugs` — toggle latent bug flags per suite.
- Determinism: `runId = offline-<sha1 of sorted scenario ids + code version>`; no wall-clock timestamps in any generated file.
