/**
 * FROZEN DATA CONTRACTS — agent-qa-lab
 * ---------------------------------------------------------------------------
 * Owned by the orchestrator. Sub-agents may READ these files but must never
 * edit them. If a contract is wrong or insufficient, stop and request a change
 * in your report (see docs/BUILD-CONTRACT.md § How to request a contract change).
 *
 * Every module in this repo speaks these types. The eval runner
 * (scripts/run-eval.ts) is the integration point that stitches them together.
 */

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

/** Suites are directories of scenarios. `smoke` is the cheap CI subset. */
export type Suite = 'smoke' | 'core' | 'redteam' | 'golden';

/** Roles the app-under-test understands. The permission matrix is seeded data. */
export type Role = 'owner' | 'admin' | 'sales_rep' | 'support_agent' | 'read_only' | 'external';

/**
 * Personas are the seeded users a scenario can act as. `manager_viktor` is
 * promoted→demoted mid-session by the stale-role-cache latent bug.
 */
export type PersonaId =
  | 'owner_emma'
  | 'manager_viktor'
  | 'rep_liam'
  | 'support_sofia'
  | 'auditor_raul'
  | 'contractor_dana';

/** A user as seeded in the app's `users` table. */
export interface SeedUser {
  id: string;
  persona: PersonaId;
  name: string;
  role: Role;
  email: string;
  /** External users are company-scoped; everyone else sees all tenants. */
  companyId: string | null;
  teamId: string | null;
}

/** Fields of the seed contract that the runner resolves from a scenario. */
export interface ResolvedActor {
  user: SeedUser;
  role: Role;
}

// ---------------------------------------------------------------------------
// Chat + tool call records
// ---------------------------------------------------------------------------

/** One message in a conversation. `content` is what the human/agent said. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Present on assistant turns that made tool calls. */
  toolCalls?: ToolCallRecord[];
}

/** Input to the agent under test (frozen agent contract, BUILD-CONTRACT §6). */
export interface ChatInput {
  scenarioId: string;
  messages: ChatTurn[];
  persona: PersonaId;
  bugFlags: Record<string, boolean>;
  provider: 'mock' | 'anthropic' | 'openai';
  onEvent?: (event: AgentEvent) => void;
}

/** Output of the agent under test (frozen agent contract, BUILD-CONTRACT §6). */
export interface ChatOutput {
  scenarioId: string;
  finalAnswer: string;
  turns: ChatTurn[];
  toolsCalled: ToolCallRecord[];
  spans: TraceSpan[];
  promptTokens: number;
  completionTokens: number;
  error?: string;
}

/** One live event streamed to a caller watching a run (spans + tool calls). */
export interface AgentEvent {
  type: 'span' | 'tool-call' | 'tool-result' | 'answer';
  span?: TraceSpan;
  name?: ToolName;
  args?: Record<string, unknown>;
  spanId?: string;
  record?: ToolCallRecord;
  answer?: string;
}

/** Tool names are frozen: the agent under test exposes exactly these six. */
export type ToolName =
  | 'search_record'
  | 'create_record'
  | 'update_record'
  | 'send_email'
  | 'check_permissions'
  | 'summarise';

/** One tool invocation, recorded for the transcript and the trace. */
export interface ToolCallRecord {
  seq: number;
  name: ToolName;
  args: Record<string, unknown>;
  ok: boolean;
  /** Short, human-readable result summary (no raw PII dumps). */
  summary: string;
  latencyMs: number;
  spanId: string;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/** Scenario categories used for reporting and trace-shape selection. */
export type ScenarioCategory =
  | 'lookup'
  | 'create-record'
  | 'update-record'
  | 'permission'
  | 'communication'
  | 'multi-step'
  | 'hallucination'
  | 'injection-direct'
  | 'injection-indirect'
  | 'cross-tenant'
  | 'exfiltration'
  | 'over-action'
  | 'pii-in-logs';

/** Scripted follow-up turns. The scenario's first user message is `userProblem`. */
export interface ScriptedTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ExpectedOutcome {
  /** Short prose: what a correct run looks like, for the judged layer. */
  description: string;
  /** The agent must refuse / not act. */
  kind: 'action-completed' | 'refusal' | 'partial-action' | 'clarification';
  /** Fields the judged rubric checks the answer against. */
  keyFacts: string[];
}

/**
 * One chat scenario. Scenarios are DATA (JSON files), never hardcoded in code.
 * See scenarios/_schema.ts for the zod schema and scenarios/_examples/ for
 * fully worked examples.
 */
export interface Scenario {
  id: string;
  suite: Exclude<Suite, 'golden'>;
  title: string;
  category: ScenarioCategory;
  persona: PersonaId;
  /** The first user message. Must start from a genuine problem, never "hi". */
  userProblem: string;
  /** Optional scripted follow-up user turns (multi-turn scenarios). */
  followUps?: ScriptedTurn[];
  /** Which seeded entities the scenario needs (empty = whole seed DB). */
  seed?: { reset?: boolean; note?: string };
  expectedOutcome: ExpectedOutcome;
  assertions: Assertion[];
  /** Expected trace shape; asserted by framework/observability. */
  trace?: TraceExpectation;
  /** Red-team probes carry a category + severity for the report. */
  redteam?: { probeId: string; severity: Severity };
  tags: string[];
  /** Why this scenario exists — the interviewer reads this. */
  rationale?: string;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

export type Severity = 'blocker' | 'major' | 'minor';
export type Layer = 'deterministic' | 'judged' | 'trace';
export type Status = 'pass' | 'fail' | 'error' | 'skip';

/** Money is integer cents everywhere. */
export type Cents = number;

/**
 * The assertion DSL. Every assertion is checkable without an LLM except
 * `llm-rubric`, which is the only judged layer. `params` are typed per variant
 * so scenario files are self-documenting and schema-validated.
 */
export type Assertion =
  | ToolCalledAssertion
  | ToolNotCalledAssertion
  | ToolArgsMatchAssertion
  | DbFieldEqualsAssertion
  | DbRecordCountAssertion
  | DbConsistencyAssertion
  | ApiResponseMatchesAssertion
  | PermissionOutcomeAssertion
  | ResponseContainsAssertion
  | LlmRubricAssertion
  | TraceShapeAssertion
  | NoPiiInOutboundAssertion
  | OutboundContainsAssertion
  | OutboundCountAssertion
  | LatencyBudgetAssertion
  | CostBudgetAssertion;

interface AssertionBase {
  id: string;
  description?: string;
  severity?: Severity;
}

/** A tool was called. `atPosition` is 1-based among all tool calls. */
export interface ToolCalledAssertion extends AssertionBase {
  type: 'tool-called';
  tool: ToolName;
  minTimes?: number;
  maxTimes?: number;
  atPosition?: number;
}

export interface ToolNotCalledAssertion extends AssertionBase {
  type: 'tool-not-called';
  tool: ToolName;
}

/** Args of the Nth occurrence (default 1) contain these fields (subset match). */
export interface ToolArgsMatchAssertion extends AssertionBase {
  type: 'tool-args-match';
  tool: ToolName;
  occurrence?: number;
  fields: Record<string, unknown>;
}

/** A row matched by `match` has `field` equal to `expected` after the chat. */
export interface DbFieldEqualsAssertion extends AssertionBase {
  type: 'db-field-equals';
  table: string;
  match: Record<string, unknown>;
  field: string;
  expected: unknown;
}

export interface DbRecordCountAssertion extends AssertionBase {
  type: 'db-record-count';
  table: string;
  where?: Record<string, unknown>;
  expected: number;
}

/**
 * Cross-field business invariants. `id` is the primary entity the check runs on.
 * - deal-total-matches-line-items: deals.amount_cents == SUM(line_items.total_cents)
 * - line-items-orphan-free: every line item references an existing deal
 * - invoice-balance-matches-payments: invoices.balance_cents == amount - paid
 */
export interface DbConsistencyAssertion extends AssertionBase {
  type: 'db-consistency';
  check:
    'deal-total-matches-line-items' | 'line-items-orphan-free' | 'invoice-balance-matches-payments';
  id: string;
}

/** Independent API check (bypasses the UI and the agent entirely). */
export interface ApiResponseMatchesAssertion extends AssertionBase {
  type: 'api-response-matches';
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  /** Optional JSON body for POST/PATCH. */
  body?: Record<string, unknown>;
  expectStatus: number;
  fields?: Record<string, unknown>;
}

/** Run the action as `asRole`; the API must allow or deny. */
export interface PermissionOutcomeAssertion extends AssertionBase {
  type: 'permission-outcome';
  asRole: Role;
  action: 'read' | 'create' | 'update' | 'delete' | 'send-email';
  resource: string;
  expected: 'allow' | 'deny';
}

/** Final natural-language answer checks (regex is JS RegExp source). */
export interface ResponseContainsAssertion extends AssertionBase {
  type: 'response-contains';
  text?: string;
  regex?: string;
  anyOf?: string[];
  noneOf?: string[];
}

/** The judged layer: rubric id + minimum overall score (1–5). */
export interface LlmRubricAssertion extends AssertionBase {
  type: 'llm-rubric';
  rubricId: string;
  minScore: number;
  dimensions?: string[];
}

export interface TraceShapeAssertion extends AssertionBase {
  type: 'trace-shape';
  shapeId: string;
}

/** No configured PII pattern may appear in an outbound email body/subject. */
export interface NoPiiInOutboundAssertion extends AssertionBase {
  type: 'no-pii-in-outbound';
  channel: 'email';
  patterns?: string[];
}

export interface OutboundContainsAssertion extends AssertionBase {
  type: 'outbound-contains';
  channel: 'email';
  text: string;
}

export interface OutboundCountAssertion extends AssertionBase {
  type: 'outbound-count';
  channel: 'email';
  to?: string;
  expected: number;
}

export interface LatencyBudgetAssertion extends AssertionBase {
  type: 'latency-budget';
  maxMs: number;
}

export interface CostBudgetAssertion extends AssertionBase {
  type: 'cost-budget';
  maxUsd: number;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** One assertion evaluated after a chat. */
export interface AssertionResult {
  scenarioId: string;
  assertionId: string;
  type: Assertion['type'];
  layer: Layer;
  status: Status;
  /** Compact rendering of what was expected and what was observed. */
  expected: string;
  actual: string;
  message: string;
  durationMs: number;
}

export interface Verdict {
  deterministic: 'pass' | 'fail';
  judged?: 'pass' | 'fail';
  trace?: 'pass' | 'fail';
  overall: Status;
  failedAssertionIds: string[];
}

/** JSON snapshot of the DB tables a scenario touched (see app-api.ts). */
export interface DbSnapshot {
  tables: Record<string, Record<string, unknown>[]>;
}

/** Field-level before/after diff — the core artefact of the verifier module. */
export interface DbDiff {
  tables: Record<
    string,
    {
      added: Record<string, unknown>[];
      removed: Record<string, unknown>[];
      changed: { id: string; field: string; before: unknown; after: unknown }[];
    }
  >;
}

/** One chat scenario executed end to end. */
export interface RunResult {
  scenarioId: string;
  suite: Exclude<Suite, 'golden'>;
  title: string;
  persona: PersonaId;
  role: Role;
  mode: 'offline' | 'live';
  provider: string;
  status: Status;
  finalAnswer: string;
  transcript: ChatTurn[];
  toolsCalled: ToolCallRecord[];
  assertions: AssertionResult[];
  dbBefore: DbSnapshot;
  dbAfter: DbSnapshot;
  verdict: Verdict;
  judgeScore?: number;
  judgeRationale?: string;
  judgeId?: string;
  judgeCached?: boolean;
  costUsd: number;
  latencyMs: number;
  traceId?: string;
  bugFlags: Record<string, boolean>;
  error?: string;
}

// ---------------------------------------------------------------------------
// Traces (observability)
// ---------------------------------------------------------------------------

/** Expected trace shape per scenario category (framework/observability). */
export interface TraceExpectation {
  shapeId: string;
  /** Span names that must appear, in this relative order. */
  requiredSpans: string[];
  forbiddenSpans?: string[];
  maxLatencyMs?: number;
  maxCostUsd?: number;
}

/** A span as emitted by the agent, in Langfuse's shape (name/kind/usage). */
export interface TraceSpan {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'agent' | 'tool' | 'llm' | 'guardrail' | 'retrieval';
  startMs: number;
  endMs: number;
  scenarioId: string;
  persona: PersonaId;
  model?: string;
  promptVersion?: string;
  input?: string;
  output?: string;
  usage?: { promptTokens: number; completionTokens: number };
  attributes?: Record<string, string | number | boolean>;
}

/** A recorded trace: the root agent run plus its spans. */
export interface Trace {
  traceId: string;
  scenarioId: string;
  spans: TraceSpan[];
}

// ---------------------------------------------------------------------------
// Judges
// ---------------------------------------------------------------------------

/** What a judge is asked to score. */
export interface JudgeRequest {
  scenarioId: string;
  persona: PersonaId;
  question: string;
  answer: string;
  expectedOutcome: ExpectedOutcome;
  rubricId: string;
  /** Deterministic facts the judge may use as grounding (tool results, DB diff). */
  grounding?: { toolsCalled: ToolCallRecord[]; dbDiff?: DbDiff };
}

export type JudgeMode = 'offline' | 'fixture' | 'live';

/** One judge's verdict, always 1–5 overall plus per-dimension scores. */
export interface JudgeVerdict {
  judgeId: string;
  model: string;
  mode: JudgeMode;
  scores: Record<string, number>;
  overall: number;
  passed: boolean;
  rationale: string;
  cached: boolean;
  costUsd: number;
  latencyMs: number;
}

/** A hand-labelled golden-set entry (see framework/judges/golden-set). */
export interface GoldenLabel {
  scenarioId: string;
  /** The human's pass/fail call — the judge is measured against this. */
  humanVerdict: 'pass' | 'fail';
  humanScore: number;
  /** Why the human labelled it so. Must quote the answer. */
  rationale: string;
  labelledBy: string;
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

/** A normalised failure, ready for dedupe + filing. */
export interface TicketCandidate {
  source: 'eval' | 'redteam' | 'verify' | 'observability';
  scenarioId: string;
  /** Stable signature for dedupe: scenario + assertion class + error class. */
  signature: string;
  title: string;
  severity: Severity;
  environment: string;
  repro: string[];
  expected: string;
  actual: string;
  evidence: {
    reportPath?: string;
    assertionIds: string[];
    transcriptRow?: number;
    traceId?: string;
  };
  costUsd: number;
  labels: string[];
}

export type TriageState = 'new' | 'duplicate' | 'closed' | 'reopened' | 'blocked';

export interface TriageDecision {
  candidate: TicketCandidate;
  state: TriageState;
  /** Ticket this was matched to (duplicate/closed/reopened). */
  matchedTicketId?: string;
  similarity?: number;
  note: string;
}

export interface TriageSummary {
  new: number;
  duplicates: number;
  closed: number;
  reopened: number;
  blocked: number;
  decisions: TriageDecision[];
}

// ---------------------------------------------------------------------------
// Reports + run metadata
// ---------------------------------------------------------------------------

/** One row of the pass/fail matrix in reports/pass-fail.md. */
export interface SuiteSummary {
  suite: string;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  notable: string;
  costUsd: number;
  latencyMs: number;
}

/**
 * Run metadata written to runs/latest/metadata.json. Deliberately contains NO
 * wall-clock timestamps: offline runs must regenerate byte-identically.
 * `runId` is deterministic (content hash of the scenario set) unless overridden
 * with RUN_ID.
 */
export interface RunMetadata {
  runId: string;
  mode: 'offline' | 'live';
  provider: string;
  bugFlags: Record<string, boolean>;
  scenarioCount: number;
  generatedBy: string;
}
