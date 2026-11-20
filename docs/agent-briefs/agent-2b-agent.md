# Agent 2b — The agent under test (tool-calling agent + mock policy)

You own: `apps/agent/**`.
You do NOT own: `apps/under-test/**` (agent 2a — you call it over HTTP),
`src/contracts/**` (read-only), `package.json`, `README.md`.

## Context

Read `docs/BUILD-CONTRACT.md` (§5 assertion semantics, §6 agent contract) and
`src/contracts/app-api.ts` (the six tool schemas + endpoint catalogue). You
build the LLM-agent that everything else evaluates. The default provider is a
**deterministic rules engine** (`mock`) — this is a deliberate design decision
(D2 in `docs/DECISIONS.md`): it makes the whole suite $0, CI-safe and
reproducible. It is NOT a stub: it has real, debuggable behaviour and real
failure modes. Anthropic and OpenAI providers are real code paths behind
`--live`.

## Deliverables

### `apps/agent/index.ts` — the frozen surface (see BUILD-CONTRACT §6)

```ts
export interface ChatInput { scenarioId; messages; persona: PersonaId;
  bugFlags: Record<string, boolean>; provider: 'mock'|'anthropic'|'openai';
  onEvent?: (e: AgentEvent) => void }
export interface ChatOutput { finalAnswer; turns: ChatTurn[]; toolsCalled: ToolCallRecord[];
  spans: TraceSpan[]; promptTokens; completionTokens; error? }
export function runChat(input: ChatInput): Promise<ChatOutput>
export interface AgentEvent { type: 'tool-call'|'tool-result'|'answer'|'span'; ... }
```

The agent calls the app over HTTP using `fetch` against the base URL from
`process.env.APP_BASE_URL` (default `http://127.0.0.1:4799`) with the
`x-actor-id` header of the persona (`PERSONA_USER_IDS`). It never touches
SQLite directly — the app owns its data.

### `apps/agent/providers/mock.ts` — the deterministic policy engine

A documented, ordered **intent table** over the seeded data. Put the intent
table in `apps/agent/policy/intents.ts` with a short prose description of each
intent in `apps/agent/policy/README.md`. Behaviour contract:

- **Intent detection**: scan the (lowercased) user utterance in order against
  the intent table. Entities are matched against the seed: full contact names
  (`con_001` ids, `Priya Nair`), company names, deal titles and deal ids
  (`dls_002`), and action verbs. Ordered rules, first match wins — the ordering
  is the behaviour, so it must be deterministic and documented.
- **Intents to cover**: lookup-contact, lookup-deal-by-id, lookup-deal-by-title,
  lookup-company, update-deal-stage, update-contact-generic, create-contact,
  create-line-items, send-email-followup, permission-refusal, clarify (ask a
  question when the request is ambiguous), not-found (correct: report the
  record does not exist) and the hallucinated fallback (bug 3's surface).
- **Permission discipline (correct behaviour)**: before any write intent, call
  `check_permissions`; on denial produce a refusal answer and make NO write.
  Read intents that the role may not read must also be refused (the API 404s
  them anyway — the agent must not retry or leak).
- **Grounded answers**: the `summarise` step composes the final answer from
  tool _results_ only, via templates that quote the fields found (ids, names,
  stages, amounts formatted as `€4,800.00` style from cents). Never claims a
  write happened unless a tool returned ok.
- **Multi-turn**: when `followUps` contains scripted assistant turns, continue
  the same plan; when they contain user turns, they are treated as the next
  user message (append to the conversation).
- **Determinism**: no `Date.now()` inside decisions (span timings use a
  monotonic counter starting at 0 — the runner records wall-clock separately),
  no randomness, no map-iteration-order dependence.

### `apps/agent/providers/anthropic.ts` and `openai.ts`

Real implementations: system prompt describing the six tools, tool schemas from
`src/contracts/app-api.ts` (JSON Schema generated from the zod schemas), a
tool-call loop (max 8 iterations), and the same span emission as the mock.
Keys via `src/lib/env.ts` `requireLiveKey`. Include retry with backoff on 429/5xx
(max 3 attempts) and the cost meter usage. These must typecheck and be
unit-runnable in "refuse politely without a key" mode: with no key they throw
the clear error from `requireLiveKey` — never a fake success.

### `apps/agent/spans.ts`

Span emission per the BUILD-CONTRACT §6 rules: root `agent.run`; `tool.<name>`
per invocation (kind `tool`); `llm.generate` for the final answer (kind `llm`,
`model`, `promptVersion: 'v1'`, `usage` populated — mock usage is a
**deterministic estimate, chars/4, labelled as an estimate**); `guardrail.pii-check`
emitted before every `tool.send_email`. Span ids `spn-<n>`, trace id
`trc-<scenarioId>`. **Bug 3 (`BUG_UNLOGGED_TOOL_SPAN`, flag ON by default)**:
when the flag is on, `send_email` emits neither its tool span nor the guardrail
span. This is a latent bug in the agent's telemetry, documented in
`apps/BUGS.md`.

### `apps/agent/README.md`

What it does, how to run it alone, inputs, outputs, and the intent table
summary.

## Acceptance (run these, paste output)

Write a scratch script (delete it before reporting, or keep it as
`apps/agent/smoke.ts` — preferred) that runs the six scenarios in
`scenarios/_examples/*.json` through `runChat` against a locally started app
(agent 2a's `startServer`), printing per scenario: tools called, final answer
(first 120 chars), and whether the `expectedOutcome.keyFacts` appear. Expected:

- With all bug flags ON: `scn-core-001` shows only ONE line item persisted
  (bug 2 surface), `scn-redteam-001` shows a stale-role leak (bug 1 surface),
  `scn-redteam/hallucination`-style probes show invented records (bug 3's app-side twin).
- With all flags OFF: all six scenarios behave correctly (keyFacts present,
  no leaked cross-tenant data, both line items persisted).
  If agent 2a's app is not ready yet, code against the frozen contract and note
  in your report that the smoke needs a running app; coordinate by re-running
  once `/health` responds.

## Report

Format from `docs/agent-briefs/_common.md` §7. Known limits must honestly state
that the mock provider is a rules engine, not a language model, and what that
means for the realism of the judged layer.
