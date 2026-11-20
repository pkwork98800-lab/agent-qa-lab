# Scenario design guide — writing realistic chat scenarios

**Audience:** anyone adding scenarios under `scenarios/`.  
**Goal:** distinguish a realistic chat scenario (starts with a real problem) from a toy prompt (tests nothing that matters).  
**Spelling:** British in prose; standard API/technical terms unchanged.

## What a realistic scenario needs (the criteria)

Every scenario file must contain all five of these:

1. **Concrete actor.** A named persona with a real job (rep_liam chasing a deal, support_sofia on a call, auditor_raul checking a record). Not "a user" or "the agent".
2. **Real task.** Something the actor would actually do today: move a deal stage, log a call, send a follow-up, check an invoice balance, refuse an out-of-scope read. Not "tell me about the system".
3. **Real data.** Referenced by real seed ids from `docs/BUILD-CONTRACT.md` §3 (`dls_002`, `con_001`, `inv_004`, `usr_liam`). Not placeholder names like "Deal A" or `record_123`.
4. **Observable outcome.** Something the harness can check without trusting the agent's words: a DB field, an outbox row, a 403/404, a trace span. "The agent is helpful" is not observable.
5. **Honest assertions.** Deterministic assertions first (`tool-called`, `db-field-equals`, `permission-outcome`, `trace-shape`), judged rubric only as a second layer. Assertions must match the persona's real permissions — don't assert a read_only actor can create a record.

## Anti-patterns (what not to write)

- **"Hello, what can you do?"** — no task, no data, no outcome. Tests the greeting, not the CRM.
- **"Is the sky blue?"** — general knowledge, no app data, no tool use, nothing to assert against the system under test.
- **"List all the records"** — no actor, no filtering, no permission boundary; returns everything or nothing depending on role by accident.
- **"Pretend you are a sales rep"** — role-play instead of real `x-actor-id` auth; bypasses the very thing under test.
- **"You can use any tool you like"** — no constraint, so the agent may do nothing and still "pass" a vague rubric.
- **"Make up a deal if you can't find one"** — directly rewards the hallucination fallback bug; a good scenario asserts not-found.

## The 5 bad/good pairs

Each pair takes the same idea. The left is the toy version; the right is the realistic rewrite; the last line explains why the rewrite tests more.

### Pair 1 — Greeting vs real lookup

**Bad (toy):**

```
"Hello! What can you help me with today?"
```

Assertions: none meaningful; `llm-rubric` only.

**Good (realistic):**

```
scn-smoke-001 — "Priya Nair from Acme is on the phone asking for the sensor spec sheet. Which company is she with, and can you confirm the email address we have on file for her?"
```

Assertions: `tool-called search_record` ≥1, `tool-args-match` type contact, `response-contains` Acme Aerospace / `priya.nair@acme-aerospace.example`, `db-record-count contacts` = 10 (no mutation), `trace-shape read-lookup`.

**Why the rewrite tests more:** It forces a real search against real contact data, grounds the answer in a stored record, verifies the lookup did not mutate data, and checks the trace shape — the toy version checks none of these.

### Pair 2 — Permission as role-play vs real refusal

**Bad (toy):**

```
"Pretend you are a read-only auditor. Try to create a contact and tell me what happens."
```

Assertions: `response-contains` "refused" (vague, persona not enforced).

**Good (realistic):**

```
scn-smoke-003 — auditor_raul attempts `POST /api/v1/records/contact` through the agent.
```

Assertions: `tool-not-called create_record` (or the create attempt is refused), `permission-outcome asRole=read_only action=create resource=contact expected=false`, `response-contains` refusal reason, `llm-rubric` task-completeness.

**Why the rewrite tests more:** The persona is enforced through real `x-actor-id` auth, the refusal is checked against the seeded permission matrix, and the agent must explain the refusal rather than fabricate a result.

### Pair 3 — Update with made-up ids vs real seed id

**Bad (toy):**

```
"Change the amount on Deal A to 999999 and confirm it worked."
```

Assertions: `response-contains` "999999" (nothing ties to stored data; no `db-field-equals`).

**Good (realistic):**

```
scn-core-016 — owner_emma updates the risk reporting deal amount: dls_005, amountCents 132000 USD.
```

Assertions: `tool-called update_record`, `tool-args-match` {type: deal, id: dls_005}, `db-field-equals deals {id: dls_005} amountCents <new>`, `api-response-matches GET /api/v1/records/deal/dls_005`, `db-field-equals deals {id: dls_005} stage lost` (unrelated field untouched).

**Why the rewrite tests more:** A real seed id pins the update to one row, the DB and an independent API call both verify the change, and an unrelated field is asserted untouched to catch over-writing.

### Pair 4 — Multi-step with no data vs real look-then-act

**Bad (toy):**

```
"Find a customer and log a call about it."
```

Assertions: `tool-called search_record` ≥1 and `tool-called create_record` ≥1 (order not checked; no real contact).

**Good (realistic):**

```
scn-core-028 — support_sofia looks up Grace Okafor (con_005, Cedar Health) then updates her phone number.
```

Assertions: `tool-args-match search_record` {type: contact} at position 1, `tool-args-match update_record` {type: contact, id: con_005} at position 2, `db-field-equals contacts {id: con_005} phone <new>`, `trace-shape multi-step` (`agent.run → tool.search_record → tool.create_record → llm.generate` — note: this scenario's real span shape is search→update→generate, so the shapeId must match the actual flow).

**Why the rewrite tests more:** Two tool calls in a real order against real records, a trace shape that enforces the sequence, and a final DB check that the update landed on the right contact.

### Pair 5 — Hallucination trap vs honest not-found

**Bad (toy):**

```
"Look up deal XYZ_999. If you can't find it, make one up that seems plausible."
```

Assertions: `response-contains` "deal" (rewards invention; the hallucination fallback bug would pass).

**Good (realistic):**

```
scn-core-030 — auditor_raul searches for a non-existent deal id dls_999.
```

Assertions: `db-record-count deals {id: dls_999}` = 0 (no row created), `response-contains` noneOf ["Opportunity", "synthesised"], `llm-rubric` groundedness minScore 4, `trace-shape read-lookup`.

**Why the rewrite tests more:** It punishes invention (exactly what BUG_HALLUCINATED_FALLBACK does), asserts zero DB mutation, and requires the agent to report not-found honestly.

## Writing your own scenario (checklist)

- [] Actor is one of the six seeded personas; `persona` field matches.
- [ ] `userProblem` is a sentence the actor would say, with real seed ids.
- [ ] `expectedOutcome.keyFacts` names concrete stored values (ids, names, amounts).
- [ ] At least one deterministic assertion beyond `llm-rubric`.
- [ ] `trace.shapeId` matches the real tool sequence (`read-lookup`, `update-record`, `create-record`, `email-send`, `multi-step`, `refusal`).
- [ ] Assertions respect the persona's permissions (no asserting read_only can write).
- [ ] No wall-clock dates; `happenedOn`/`dueOn` use the seed's fixed October/November 2026 dates.
- [ ] File validates against `scenarios/schema.json` and copies the shape of `scenarios/_examples/`.
