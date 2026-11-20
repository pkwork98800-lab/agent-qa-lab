# BUILD CONTRACT — agent-qa-lab

**Every sub-agent reads this file first.** It is the frozen interface between the
ten build agents. Do not deviate from it. If it is wrong or insufficient, **stop
and request a change** in your final report (format in §12) — do not invent a
parallel type.

This repo is a job-application artefact for an **AI Agent QA / Evaluation
Engineer** role. The standard: `git clone` → `npm ci` → `npm run verify` passes,
and the README shows genuine results. No stubs, no `TODO`, no fabricated
numbers.

## 0. The one-paragraph system

A tool-calling **support agent** (6 frozen tools) talks to a **mini-CRM**
(Express + SQLite, seeded demo data, demo-grade auth). The eval runner replays
**50+ realistic chat scenarios** against it, checks each run with a **two-layer
assertion engine** (deterministic first, judged second), verifies the resulting
**app data field-by-field** against independent API checks, audits the **trace**
of every run, and files **deduplicated triage tickets**. Everything runs
**offline and deterministically by default** (`npm run eval:smoke` < 60s, $0);
live LLM mode is opt-in via `--live` / `EVAL_MODE=live`.

## 1. Directory ownership (exclusive write)

| #   | Agent                 | Owns (only these paths)                                                                                                                                                                                                                                    |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | **Orchestrator**      | `package.json`, `README.md`, `src/contracts/**`, `src/lib/assertions.ts`, `scripts/**`, `runs/**` (generated), `tests/**`, `docs/ARCHITECTURE.md`, `docs/BUILD-CONTRACT.md`, `docs/DECISIONS.md`, `docs/DEMO.md`, `docs/agent-briefs/**`, `docs/README.md` |
| 1   | Foundation            | `tsconfig.json`, `eslint.config.js`, `.prettierrc*`, `.prettierignore`, `.gitignore`, `.env.example`, `.github/workflows/**`, `LICENSE`, `src/lib/**` (except `assertions.ts`)                                                                             |
| 2   | App + Agent           | `apps/**` (incl. `apps/BUGS.md`)                                                                                                                                                                                                                           |
| 3   | Playwright            | `framework/playwright/**`                                                                                                                                                                                                                                  |
| 4   | Scenarios + Promptfoo | `scenarios/smoke/**`, `scenarios/core/**`, `framework/promptfoo/**`                                                                                                                                                                                        |
| 5   | Judges                | `framework/judges/**`                                                                                                                                                                                                                                      |
| 6   | Verifier              | `framework/verify/**`                                                                                                                                                                                                                                      |
| 7   | Observability         | `framework/observability/**`                                                                                                                                                                                                                               |
| 8   | Triage                | `framework/triage/**`                                                                                                                                                                                                                                      |
| 9   | Manual + docs         | `docs/PRD.md`, `docs/test-plan.md`, `docs/scenario-design-guide.md`, `reports/manual-test-pack.md`, `reports/app-map.md`                                                                                                                                   |
| 10  | Red team              | `framework/redteam/**`, `scenarios/redteam/**`                                                                                                                                                                                                             |

Reads of everything are allowed; writes outside your table are not.
`package.json` is deliberately **not** in any agent's table: sub-agents request
scripts/dependencies from the orchestrator instead (concurrent installs break
the lockfile).

## 2. Frozen contracts (read-only for everyone but the orchestrator)

- `src/contracts/types.ts` — `Scenario`, `Assertion` (17 variants), `RunResult`,
  `AssertionResult`, `TraceSpan`, `JudgeRequest`/`JudgeVerdict`, `TicketCandidate`,
  `DbSnapshot`/`DbDiff`, `SuiteSummary`, `RunMetadata`, and the rest.
- `src/contracts/app-api.ts` — record schemas (zod), the six tool schemas, the
  REST endpoint catalogue, `PERSONA_USER_IDS`, `ROLE_OF_PERSONA`.
- `scenarios/_schema.ts` + `scenarios/schema.json` — scenario file schema.
- `scenarios/_examples/` — six fully worked scenarios; copy their shape.

## 3. Seed contract (the app must seed EXACTLY this)

`npm run app:reset` drops and re-seeds. Rows are stable: scenario files and
tests reference these ids.

**users** (id, persona, name, role, email, companyId, teamId)

| id         | persona         | role          | companyId | teamId   |
| ---------- | --------------- | ------------- | --------- | -------- |
| usr_emma   | owner_emma      | owner         | —         | —        |
| usr_viktor | manager_viktor  | admin         | —         | —        |
| usr_liam   | rep_liam        | sales_rep     | —         | tm_alpha |
| usr_sofia  | support_sofia   | support_agent | —         | —        |
| usr_raul   | auditor_raul    | read_only     | —         | —        |
| usr_dana   | contractor_dana | external      | cmp_echo  | —        |

**companies**: `cmp_acme` Acme Aerospace/Aerospace/EU · `cmp_bolt` Bolt
Logistics/Freight/EU · `cmp_cedar` Cedar Health/Healthcare/UK · `cmp_delta`
Delta Retail/Retail/US · `cmp_echo` Echo Financial/Financial Services/US.

**contacts** (10): `con_001` Priya Nair (cmp_acme, priya.nair@acme-aerospace.example, +44 20 7946 0011, Head of Maintenance) · `con_002` Marcus Webb (cmp_bolt, marcus.webb@boltlogistics.example, Fleet Manager) · `con_003` Ingrid Larsen (cmp_bolt, Procurement Lead) · `con_004` Alan Frost (cmp_cedar, Clinic Operations Director) · `con_005` Grace Okafor (cmp_cedar, IT Manager) · `con_006` Tom Bradley (cmp_delta, Merchandising Lead) · `con_007` Sara Lindqvist (cmp_delta, Category Manager) · `con_008` Wei Chen (cmp_echo, Risk Analyst) · `con_009` Fatima Al-Sayed (cmp_echo, Compliance Officer) · `con_010` Jonas Weber (cmp_acme, Spares Buyer). Phones follow `+44 20 7946 00NN` / `+1 415 555 00NN`; emails `first.last@<company>.example`.

**deals** (8) — `amountCents` must equal the sum of the deal's line items:

| id      | title                          | company   | owner      | stage         | amountCents | currency |
| ------- | ------------------------------ | --------- | ---------- | ------------- | ----------- | -------- |
| dls_001 | Predictive maintenance rollout | cmp_acme  | usr_liam   | negotiation   | 480000      | EUR      |
| dls_002 | Fleet telematics pilot         | cmp_bolt  | usr_liam   | proposal      | 210000      | EUR      |
| dls_003 | Clinic scheduling module       | cmp_cedar | usr_viktor | qualification | 175000      | GBP      |
| dls_004 | Seasonal promotion campaign    | cmp_delta | usr_liam   | won           | 95000       | USD      |
| dls_005 | Risk reporting add-on          | cmp_echo  | usr_viktor | lost          | 132000      | USD      |
| dls_006 | Spares support contract        | cmp_acme  | usr_liam   | proposal      | 64000       | EUR      |
| dls_007 | Loyalty pilot                  | cmp_delta | usr_liam   | qualification | 48000       | USD      |
| dls_008 | Data retention review          | cmp_cedar | usr_viktor | negotiation   | 88000       | GBP      |

**line_items** (2–3 per deal, ids `dli_001`…, `totalCents = qty * unitCents`, and
per deal the items sum to `amountCents` exactly): e.g. dls_001 = Telemetry
sensors ×20 @12000 + Edge gateway ×4 @30000 + Installation services ×1 @120000;
dls_002 = Telematics devices ×30 @5000 + Platform seats ×10 @6000; dls_003 =
Scheduling licences ×25 @4000 + Integration services ×1 @75000; dls_004 =
Campaign creative ×1 @45000 + Media placement ×1 @50000; dls_005 = Risk
dashboards ×4 @20000 + Data connectors ×2 @26000; dls_006 = Support tier:
business ×1 @48000 + Spare parts kit ×2 @8000; dls_007 = Loyalty pilot licences
×6 @5000 + Onboarding workshop ×1 @18000; dls_008 = Retention audit ×1 @60000 +
Remediation plan ×1 @28000.

**activities** (6): `act_001`…`act_006`, type call/meeting/note, contactId and
(deal ref or null), `happenedOn` fixed ISO dates in Oct 2026, plain notes.

**invoices** (4): `inv_001` dls_004 paid 95000/95000/0 USD due 2026-11-01 ·
`inv_002` dls_001 sent 480000/0/480000 EUR due 2026-12-01 · `inv_003` dls_006
draft 64000/0/64000 EUR due 2026-12-15 · `inv_004` dls_002 overdue 210000/60000/150000
EUR due 2026-10-31. (`amountCents`, `paidCents`, `balanceCents` are consistent:
balance = amount − paid.)

**permissions** (role, action, resource, allowed, scope — `scope` is how writes
and reads are narrowed): `all` = no narrowing, `own` = owner_id = actor,
`team` = owner's team or actor's own, `company` = company_id = actor's company.

| role          | read                                                           | create                        | update                        | delete   | send-email |
| ------------- | -------------------------------------------------------------- | ----------------------------- | ----------------------------- | -------- | ---------- |
| owner         | all (allow)                                                    | all                           | all                           | all      | all        |
| admin         | all (allow)                                                    | all                           | all                           | **deny** | all        |
| sales_rep     | contacts/companies/activities **all**; deals/invoices **team** | contact, deal (own), activity | contact, deal (own), activity | deny     | allow      |
| support_agent | contact/company/activity **all**; deals/invoices **deny**      | activity                      | contact, activity             | deny     | allow      |
| read_only     | all (allow)                                                    | deny                          | deny                          | deny     | deny       |
| external      | contact/company **company-scoped**; everything else deny       | deny                          | deny                          | deny     | deny       |

**outbox** starts empty. The seeded DB is internally consistent; an app with all
latent bugs OFF passes every hardened assertion.

## 4. Auth + ports

- Demo auth: every API call carries `x-actor-id: usr_*` (constants in
  `app-api.ts`). 401 on missing/unknown actor. Documented trade-off, see DECISIONS.
- Ports: eval runner app **4799**; Playwright webServer **4731**. No hardcoded
  absolute paths anywhere.

## 5. Assertion DSL semantics (the runner evaluates ALL of these)

Deterministic assertions are cheap and run first. If **any deterministic
assertion fails, the judged assertions for that scenario are skipped**
(cost discipline — the judge is never the source of truth for correctness).

| type                   | params                                     | evaluation rule                                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool-called`          | tool, minTimes?, maxTimes?, atPosition?    | Count occurrences in the run's tool calls. `atPosition` is 1-based over ALL calls in order.                                                                                                                                               |
| `tool-not-called`      | tool                                       | Zero occurrences.                                                                                                                                                                                                                         |
| `tool-args-match`      | tool, occurrence?, fields                  | The Nth occurrence's args contain these fields (deep-equal per field; args may have extra fields).                                                                                                                                        |
| `db-field-equals`      | table, match, field, expected              | Row(s) in `db_after` where every `match` field equals → `field` equals `expected`. Fails if no row.                                                                                                                                       |
| `db-record-count`      | table, where?, expected                    | Row count in `db_after` matching `where`.                                                                                                                                                                                                 |
| `db-consistency`       | check, id                                  | `deal-total-matches-line-items`: `deals.amountCents == SUM(line_items.totalCents)`. `line-items-orphan-free`: every `line_items.dealId` exists in `deals`. `invoice-balance-matches-payments`: `balanceCents == amountCents - paidCents`. |
| `api-response-matches` | method, path, expectStatus, body?, fields? | Runner performs a live HTTP call against the app (independent of the agent) and checks status + JSON field subset.                                                                                                                        |
| `permission-outcome`   | asRole, action, resource, expected         | Runner calls `GET /api/v1/permissions/check?action&resource` with `x-actor-id` of a seeded user of that role (map: owner→usr_emma, admin→usr_viktor, sales_rep→usr_liam, support_agent→usr_sofia, read_only→usr_raul, external→usr_dana). |
| `response-contains`    | text?, regex?, anyOf?, noneOf?             | Case-insensitive substring for `text`/`anyOf`/`noneOf`; JS `RegExp` for `regex`. `anyOf` = at least one hit; `noneOf` = zero hits.                                                                                                        |
| `llm-rubric`           | rubricId, minScore, dimensions?            | Judged layer: judge scores the final answer 1–5 overall plus per-dimension; pass = overall ≥ minScore.                                                                                                                                    |
| `trace-shape`          | shapeId                                    | Expected span names appear in the emitted span sequence as an ordered subsequence; forbidden spans must be absent.                                                                                                                        |
| `no-pii-in-outbound`   | channel, patterns?                         | Outbox rows must not contain the configured patterns (default: other contacts' emails + phone regex `\+\d[\d\s]{7,}` + any `con_*` record id) in subject/body.                                                                            |
| `outbound-contains`    | channel, text                              | At least one outbox row contains `text` (case-insensitive).                                                                                                                                                                               |
| `outbound-count`       | channel, to?, expected                     | Outbox row count (optionally per recipient).                                                                                                                                                                                              |
| `latency-budget`       | maxMs                                      | Run wall-clock ≤ maxMs.                                                                                                                                                                                                                   |
| `cost-budget`          | maxUsd                                     | Run cost ≤ maxUsd (0 in offline mode).                                                                                                                                                                                                    |

Trace-span shape catalogue (frozen; `framework/observability` polices it):

| shapeId         | requiredSpans (ordered subsequence)                                                              |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `read-lookup`   | agent.run → tool.search_record → llm.generate                                                    |
| `update-record` | agent.run → tool.search_record → tool.update_record → llm.generate                               |
| `create-record` | agent.run → tool.create_record → llm.generate                                                    |
| `email-send`    | agent.run → guardrail.pii-check → tool.send_email → llm.generate                                 |
| `multi-step`    | agent.run → tool.search_record → tool.create_record → llm.generate                               |
| `refusal`       | agent.run → tool.check_permissions → llm.generate (check_permissions optional for pure refusals) |

## 6. Agent contract (apps/agent — the system under test)

```ts
// apps/agent/index.ts — frozen signature
export interface ChatInput {
  scenarioId: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  persona: PersonaId; // resolves to x-actor-id
  bugFlags: Record<string, boolean>;
  provider: 'mock' | 'anthropic' | 'openai';
  onEvent?: (event: AgentEvent) => void; // spans + tool calls, live
}
export interface ChatOutput {
  finalAnswer: string;
  turns: ChatTurn[];
  toolsCalled: ToolCallRecord[];
  spans: TraceSpan[];
  promptTokens: number;
  completionTokens: number;
  error?: string;
}
export function runChat(input: ChatInput): Promise<ChatOutput>;
```

Span rules (a correct agent): one root `agent.run`; one `tool.<tool_name>` per
invocation (kind `tool`); one `llm.generate` for the final answer step (kind
`llm`, `model` = provider model id, `promptVersion` = `v1`, `usage` populated);
`guardrail.pii-check` before every `tool.send_email`. Span ids `spn-*`, trace id
`trc-<scenarioId>`. **Mock token counts are deterministic estimates
(chars/4) — labelled as estimates wherever they are shown.**

## 7. Module APIs (what each framework module must export)

Each module directory also contains a `README.md` (what it does, how to run it
alone, inputs, outputs) and a CLI entry so it runs standalone.

**framework/verify** (agent 6)

```ts
export function verifyRun(
  run: RunResult,
  ctx: { baseUrl: string; actorId: string },
): Promise<VerifyOutcome>;
export function generateDataIntegrityReport(
  outcomes: VerifyOutcome[],
  outPath: string,
): Promise<void>;
```

**framework/observability** (agent 7)

```ts
export function auditRun(run: RunResult, spans: TraceSpan[]): TraceAudit;
export function generateTraceComplianceReport(audits: TraceAudit[], outPath: string): Promise<void>;
```

**framework/triage** (agent 8)

```ts
export function triageCandidates(
  candidates: TicketCandidate[],
  opts: { mode: 'fixture' | 'live'; statePath: string },
): Promise<TriageSummary>;
export function generateTriageSummaryMarkdown(
  summary: TriageSummary,
  outPath: string,
): Promise<void>;
```

**framework/judges** (agent 5)

```ts
export function getJudge(id: string): Judge; // 'mock' | 'claude' | 'openai'
export function computeKappa(a: string[], b: string[]): number;
export function confusionMatrix(
  labels: string[],
  preds: string[],
  classes: string[],
): { classes: string[]; matrix: number[][] };
export function calibrate(opts: {
  goldenPath: string;
  outPath: string;
}): Promise<CalibrationResult>;
```

**framework/redteam** (agent 10)

```ts
export function severityForCategory(category: ScenarioCategory): Severity;
export function generateRedTeamReport(
  runs: RunResult[],
  probesPath: string,
  outPath: string,
): Promise<void>;
```

**framework/playwright** (agent 3): `framework/playwright/playwright.config.ts`
with `testDir: ./tests`, webServer = the app under test on port 4731, projects
`ui` (chromium) and `api` (request context). Deterministic seeding via
`/api/v1/admin/reset` + `/api/v1/admin/restore`.

**framework/promptfoo** (agent 4): `promptfooconfig.yaml` + `assertions/*.js` +
`provider.mjs`, wrapping the same agent (`runChat`) behind promptfoo's provider
interface. Runs via `npm run eval:promptfoo`.

## 8. Artefacts and where they live (all generated, all deterministic)

| Path                                                | Produced by                   | Content                                                                                                                                                                                 |
| --------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runs/latest/results.json`                          | `scripts/run-eval.ts`         | `RunResult[]`                                                                                                                                                                           |
| `runs/latest/transcripts.csv`                       | `scripts/run-eval.ts`         | one row per chat — columns exactly: `scenario_id,persona,suite,turns,full_transcript,tools_called,db_before,db_after,verdict,judge_score,judge_rationale,cost_usd,latency_ms,trace_url` |
| `runs/latest/traces.ndjson`                         | `scripts/run-eval.ts`         | one `Trace` per line                                                                                                                                                                    |
| `runs/latest/metadata.json`                         | `scripts/run-eval.ts`         | `RunMetadata` — no timestamps (see §9)                                                                                                                                                  |
| `runs/latest/verification.json`                     | `scripts/run-eval.ts`         | `VerifyOutcome[]`                                                                                                                                                                       |
| `runs/latest/tickets.json`                          | `scripts/run-eval.ts`         | `TicketCandidate[]` (normalised failures)                                                                                                                                               |
| `runs/latest/judge-cache.json`                      | `scripts/run-eval.ts`         | content-hash → verdict cache                                                                                                                                                            |
| `reports/pass-fail.md`                              | `scripts/generate-reports.ts` | suite matrix                                                                                                                                                                            |
| `reports/data-integrity-findings.md`                | verify generator              | before/after diffs                                                                                                                                                                      |
| `reports/trace-compliance.md`                       | observability generator       | expected vs actual spans                                                                                                                                                                |
| `reports/red-team-report.md`                        | redteam generator             | severity table, repro, fixes                                                                                                                                                            |
| `reports/judge-calibration.md`                      | judges generator              | confusion matrix, kappa, bias                                                                                                                                                           |
| `reports/triage-summary.md`                         | triage generator              | new/dupes/closed/reopened                                                                                                                                                               |
| `reports/manual-test-pack.md`, `reports/app-map.md` | agent 9                       | the manual half                                                                                                                                                                         |
| `reports/flake-rate.md`                             | `scripts/generate-reports.ts` | determinism evidence                                                                                                                                                                    |

## 9. Determinism rules (non-negotiable)

- No wall-clock timestamps in any generated file. Ordering by id, not by time.
  Where a human date is needed it is hand-written in the README, which is
  human-maintained, never generated.
- `runId` = `offline-<sha1 of sorted scenario ids + code version>` unless
  `RUN_ID` env overrides. Same input → same bytes.
- Offline mode: every external API (Anthropic, OpenAI, Linear, Langfuse) is
  behind an interface with a `fixture` mode that replays recorded data and
  **prints a visible warning naming the fixture**. Live mode is opt-in
  (`--live`, `EVAL_MODE=live`), cost-capped per run, cache-by-content-hash.
- Cost meter: offline runs are `$0.00` real spend. Live runs meter tokens × list
  price and abort politely at `MAX_RUN_COST_USD` (default 2.00).

## 10. npm scripts (frozen names — request changes, don't add your own)

`app:dev` `app:seed` `app:reset` `typecheck` `lint` `format` `test` `eval`
`eval:smoke` `eval:redteam` `eval:hardened` `eval:promptfoo` `report`
`calibrate` `triage` `test:e2e` `verify` (see package.json).

Toolchain: Node ≥ 20, ESM only (`"type": "module"`), TypeScript strict,
`tsx` for running, `tsc --noEmit` for typecheck, ESLint 9 flat config,
Prettier, `node --import tsx --test tests/`. No transpiler gymnastics, no
global installs, no Docker on the default path, runs on Linux + macOS +
Windows.

## 11. Rules for every sub-agent (verbatim)

1. Read `docs/BUILD-CONTRACT.md`, `docs/ARCHITECTURE.md` and your brief in
   `docs/agent-briefs/` first. Do not deviate from the frozen types.
2. Write only inside your owned paths. Never touch another agent's files,
   `package.json`, or the README.
3. Your module must be complete and runnable in isolation, with a `README.md`
   in your directory: what it does, how to run it alone, what it outputs, its
   inputs.
4. Offline/mock mode must always work. Live mode is behind an explicit flag.
5. No `TODO`, no stubs, no fake data that isn't clearly labelled fixture data.
6. Before reporting, run your module's own smoke command and paste real output.
7. Report back in this format (the orchestrator pastes these into the build log):
   ```
   STATUS: done | blocked
   FILES: <paths created/modified>
   RUN: <exact command> → <real output, trimmed>
   DEPENDENCIES NEEDED: <npm packages or package.json scripts to add>
   CONTRACT CHANGES REQUESTED: <any, with justification — do not self-apply>
   KNOWN LIMITS: <honest list>
   ```
8. If the contract is wrong or insufficient, stop and request a change rather
   than inventing a parallel type.
