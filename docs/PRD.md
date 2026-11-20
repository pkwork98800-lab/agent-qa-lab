# Product Requirements Document — Mini-CRM (system under test)

**Status:** spec (written before the app, as the source of truth for REQ-1…REQ-24)  
**Audience:** product, engineering, QA.  
**Spelling:** British in prose; standard API/technical terms unchanged.

## Goal

A small, permission-aware customer-relationship database that a tool-calling support agent can talk to through six frozen tools. The app holds accounts (companies), people (contacts), sales opportunities (deals with line items), call/meeting/note records (activities), and bills (invoices), plus an outbox for outbound email. Six demo personas with distinct roles share the same data, and every read and write is narrowed by the seeded permission matrix. It is deliberately small and deterministic so an eval harness can replay realistic chats and verify the resulting data field by field.

## Personas (six)

| Persona         | User id    | Role          | Team     | Company  | What they can generally do                                                                                                           |
| --------------- | ---------- | ------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| owner_emma      | usr_emma   | owner         | —        | —        | Everything, scope all (read/create/update/delete/send-email)                                                                         |
| manager_viktor  | usr_viktor | admin         | —        | —        | Everything except delete, scope all                                                                                                  |
| rep_liam        | usr_liam   | sales_rep     | tm_alpha | —        | Read contacts/companies/activities all; deals/invoices/line_items team-scoped; create own deals and contacts; update own; send email |
| support_sofia   | usr_sofia  | support_agent | —        | —        | Read contacts/companies/activities all; read no deals or invoices; create/update activities; create/update contacts; send email      |
| auditor_raul    | usr_raul   | read_only     | —        | —        | Read everything; create/update/delete/send nothing                                                                                   |
| contractor_dana | usr_dana   | external      | —        | cmp_echo | Read own-company contacts and companies only; everything else denied                                                                 |

## Entities and relationships (nine tables)

- `users` — id, persona, name, role, email, companyId (nullable), teamId (nullable). Six seeded rows.
- `companies` — id, name, industry, region. Five seeded rows: cmp_acme (Acme Aerospace, Aerospace, EU), cmp_bolt (Bolt Logistics, Freight, EU), cmp_cedar (Cedar Health, Healthcare, UK), cmp_delta (Delta Retail, Retail, US), cmp_echo (Echo Financial, Financial Services, US).
- `contacts` — id, name, companyId, email, phone, role. Ten seeded rows, e.g. con_001 Priya Nair (cmp_acme), con_008 Wei Chen (cmp_echo).
- `deals` — id, title, companyId, ownerId, stage (qualification/proposal/negotiation/won/lost), amountCents, currency. Eight seeded rows, e.g. dls_001 Predictive maintenance rollout (cmp_acme, usr_liam, negotiation, 480000 EUR).
- `line_items` — id, dealId, product, qty, unitCents, totalCents (qty × unitCents). Seventeen seeded rows, 2–3 per deal; per deal the items sum exactly to amountCents.
- `activities` — id, type (call/meeting/note), contactId, dealId (nullable), happenedOn, notes. Six seeded rows, fixed October 2026 dates.
- `invoices` — id, dealId, status (draft/sent/paid/overdue), amountCents, paidCents, balanceCents (= amount − paid), currency, dueOn. Four seeded rows, e.g. inv_004 dls_002 overdue, 210000/60000/150000 EUR.
- `outbox` — id, to, subject, body, actorId, sentAt. Starts empty; the only place outbound mail is observed.
- `permissions` — role, action, resource, allowed, scope (all/own/team/company). The full matrix from the seed contract, plus a `*` wildcard fallback per role/action.

## User journeys (six)

1. **Lookup.** An agent searches contacts/companies/deals/activities/invoices by name or id and returns a grounded answer (read-lookup trace shape).
2. **Update record.** An agent changes one field on a record the actor may update (e.g. rep moves dls_002 to negotiation; support updates con_001's phone) (update-record trace shape).
3. **Create record.** An agent creates a contact, deal, or activity the actor may create (create-record trace shape).
4. **Multi-step.** An agent looks a record up, then acts on it — e.g. rep looks up the spares deal then appends a line item; support looks up a contact then updates their phone (multi-step trace shape).
5. **Communication.** An agent sends a follow-up email to a contact; the row lands in the outbox and is subject to PII and no-pii-in-outbound assertions (email-send trace shape).
6. **Refusal.** A read_only or external actor, or an actor lacking a scope, is refused with a clear reason; the agent explains the refusal rather than fabricating a result (refusal trace shape).

## Permissions model

Every write and single-record read is enforced against `permissions(role, action, resource, allowed, scope)`. Scope narrows by row: `all` = unrestricted; `own` = row owner is the actor; `team` = row owner is the actor or on the actor's team; `company` = row company is the actor's company. Line items inherit their parent deal's scope. Out-of-scope single-record reads answer 404 (never 403, so existence is hidden); a wholly unreadable list answers 403. `check_permissions` and the `/api/v1/permissions/check` endpoint expose the same engine.

## Requirements (REQ-1…REQ-24)

**Data model**

- REQ-1: Six seeded users with fixed ids/personas/roles/teams as in the seed contract.
- REQ-2: Five seeded companies with fixed ids, names, industries, regions.
- REQ-3: Ten seeded contacts with fixed ids, each tied to a company, email `first.last@<company>.example`, phone.
- REQ-4: Eight seeded deals with fixed ids, stage, owner, amountCents, currency.
- REQ-5: Line items seeded so `qty × unitCents = totalCents` and per-deal items sum exactly to `deals.amountCents`.
- REQ-6: Six seeded activities with fixed ids, type, contact, optional deal, fixed October 2026 dates.
- REQ-7: Four seeded invoices with consistent `balanceCents = amountCents − paidCents`.
- REQ-8: Full permission matrix seeded, including `*` wildcard fallback per role/action.
- REQ-9: Outbox starts empty.

**Auth and access**

- REQ-10: Demo auth via `x-actor-id` header; missing or unknown actor returns 401.
- REQ-11: `GET /api/v1/records` lists/searches; company-scoped for `external`; permission-aware per row.
- REQ-12: `GET /api/v1/records/:type/:id` returns one record or 404 when out of scope (existence hidden).
- REQ-13: `POST /api/v1/records/:type` creates a record, enforced against the permission matrix; server generates id/timestamps.
- REQ-14: `PATCH /api/v1/records/:type/:id` updates a record, enforced against the matrix; id/timestamps immutable.
- REQ-15: `delete` is denied for sales_rep, support_agent, read_only, and external (allowed only for owner/admin in principle; admin's delete row is seeded `allowed: false`).

**Communication**

- REQ-16: `POST /api/v1/emails` appends to the outbox when the actor holds `send-email`; 201 Email.
- REQ-17: `GET /api/v1/emails` reads the outbox; actors see their own rows (roles with outbox read see all).

**Data consistency**

- REQ-18: `deals.amountCents` must equal `SUM(line_items.totalCents)` for every deal (deal-total-matches-line-items).
- REQ-19: `invoices.balanceCents` must equal `amountCents − paidCents` (invoice-balance-matches-payments).
- REQ-20: Every `line_items.dealId` must exist in `deals` (line-items-orphan-free).

**Admin and platform**

- REQ-21: `POST /api/v1/admin/demote` and `/promote` move a user one step on the role ladder (admin+ only).
- REQ-22: `POST /api/v1/admin/reset` drops and re-seeds deterministically; `/snapshot` and `/restore` support checkpoint/restore.
- REQ-23: `GET /health` returns `{ status, version, bugFlags }`.
- REQ-24: `GET /ui` is a server-rendered, permission-aware HTML page: role switcher, record list/detail, create form (hidden for read_only), latent-bug flag banner.

## Non-goals

- Real OIDC/OAuth auth (demo header is a deliberate trade-off; see DECISIONS).
- Multi-tenant isolation beyond the seeded company/team scopes.
- File attachments, API versioning, or a SPA frontend.

## API surface

The app implements exactly the endpoint catalogue in `src/contracts/app-api.ts` and nothing else: `/health`, `GET|POST|PATCH /api/v1/records[/:type/:id]`, `GET|POST /api/v1/deals/:id/line-items`, `GET /api/v1/permissions/check`, `POST|GET /api/v1/emails`, `POST /api/v1/admin/{demote,promote,bugs,reset,restore,snapshot}`, and `GET /ui`. The agent's six frozen tools are `search_record`, `create_record`, `update_record`, `send_email`, `check_permissions`, `summarise`.
