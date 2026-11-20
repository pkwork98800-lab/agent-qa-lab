# Agent 2a — App under test (Express + SQLite mini-CRM + UI)

You own: `apps/under-test/**` including `apps/BUGS.md`.
You do NOT own: `apps/agent/**` (agent 2b), `src/contracts/**` (read-only),
`package.json`, `README.md`.

## Context

Read `docs/BUILD-CONTRACT.md` (§3 seed contract, §4 auth+ports, §5 assertion
semantics, endpoint catalogue in `src/contracts/app-api.ts`). You build the
thing everything else points at. It must be a _real_ small web app: real
Express routes, real SQLite schema, real server-rendered UI, real permission
enforcement, and four realistic latent bugs behind feature flags.

## Deliverables

### `apps/under-test/schema.ts`

SQLite DDL for tables `users, companies, contacts, deals, line_items,
activities, invoices, outbox, permissions` (snake_case columns, ids as in the
seed contract). Foreign keys declared and `PRAGMA foreign_keys = ON`. Column
names must match the TS types in `src/contracts/app-api.ts` (e.g. `amount_cents`
↔ `amountCents` — pick ONE convention: use camelCase SQLite columns so the
snapshot JSON matches the TS types with zero mapping; document that choice in
your README).

### `apps/under-test/seed.ts`

The seed contract in BUILD-CONTRACT §3 EXACTLY: 6 users, 5 companies, 10
contacts, 8 deals with line items summing exactly to each deal amount, 6
activities, 4 invoices with consistent `paidCents/balanceCents`, the full
permission matrix, empty outbox. Fixed ISO `createdAt/updatedAt` values
(deterministic — e.g. `2026-11-01T09:00:00.000Z`). Export `SEED` (the data as
plain objects) so tests can assert against it.
CLI: `npx tsx apps/under-test/seed.ts` re-seeds; `--reset` drops tables first.

### `apps/under-test/db.ts`

`better-sqlite3` wrapper: `openDb(path?)` (default in-memory, `APP_DB_PATH`
env for a file), `resetDatabase()`, `seedDatabase()`, `snapshotDatabase():
DbSnapshot` (all 9 tables, rows sorted by id — the runner diffs this),
`restoreDatabase(snapshot)`, `getBugFlags()`, `setBugFlags(flags)`. All
synchronous and deterministic.

### `apps/under-test/permissions.ts`

Permission engine over the seeded `permissions` table: `can(role, action,
resource, actor, row): { allowed, reason }` implementing the scopes (`all`,
`own`, `team`, `company`) from BUILD-CONTRACT §3. `check_permissions` and every
write route call this.

### `apps/under-test/app.ts`

`createApp()` — the Express app implementing EXACTLY the endpoint catalogue in
`src/contracts/app-api.ts` (`ENDPOINTS`) and nothing else:

- `x-actor-id` middleware: 401 when missing/unknown.
- Records CRUD with permission enforcement + 404 (not 403) for out-of-scope
  reads — 404 hides record existence.
- `GET /api/v1/permissions/check?action&resource`.
- Deals line-items append.
- Outbox: `POST /api/v1/emails`, `GET /api/v1/emails`.
- Admin: snapshot/restore/reset/bugs/demote/promote. `demote` lowers
  `manager_viktor` from admin → sales_rep in the DB.
- `GET /ui` — server-rendered HTML (plain template strings, no build step, no
  framework): role switcher (selects the demo actor), record list with search,
  record detail, and a create-contact form. It must be genuinely usable by a
  human in a browser: semantic HTML, a `<style>` block, form posts, and
  permission-aware rendering (read_only sees no create form; create attempts
  show the server's 403 message). Keep it ~300 lines.
- Error handler: JSON `{ error }` with the right status codes.

### `apps/under-test/server.ts`

`startServer({ port }): { url, close, app }` (default port from
`src/lib/config.ts` `APP_PORT`). CLI: `npm run app:dev` and
`npx tsx apps/under-test/server.ts` start it and log the URL.

### `apps/under-test/index.ts` — the frozen module surface

```ts
export { createApp } from './app.ts';
export { startServer } from './server.ts';
export {
  resetDatabase,
  seedDatabase,
  snapshotDatabase,
  restoreDatabase,
  getBugFlags,
  setBugFlags,
  openDb,
} from './db.ts';
export { SEED } from './seed.ts';
export { can } from './permissions.ts';
```

### The four latent bugs (`apps/under-test/bugs.ts`)

Each behind its flag, default **ON**, documented in `apps/BUGS.md` (flag name,
one-paragraph root cause, how to reproduce by hand, which assertion class
catches it, and the flag-to-off instruction):

1. `BUG_STALE_ROLE_CACHE` — a module-level `Map<actorId, Role>` populated on
   first request and never refreshed; `can()` reads the cache when the flag is
   on. A demotion mid-session leaves the old role authoritative.
2. `BUG_PARTIAL_LINE_ITEM_WRITE` — appending ≥2 line items as `sales_rep`
   updates the deal total but persists only the first line item.
3. `BUG_HALLUCINATED_FALLBACK` — a search whose query looks like a record id
   (`dls_999`) returns a synthesised record instead of zero rows. (This one
   lives in the app's search endpoint since agent 2b's policy calls it.)
4. `BUG_UNLOGGED_TOOL_SPAN` — implemented by agent 2b (the agent emits no span
   for `send_email`); your part is only documenting it in `apps/BUGS.md` and
   making sure nothing else compensates for it.
   Bugs must be _realistic_: each is the kind of thing that ships to production,
   not an artificial `throw`.

## Acceptance (run these, paste output)

```bash
npm run app:reset
npx tsx -e "<boot the app, GET /health, GET /api/v1/records as usr_liam, POST a record, GET /api/v1/admin/snapshot>"
```

Show: health JSON, one record list, one permission denial (403/404), one
snapshot table count, and a demonstration of bug 1 (demote then a write as the
stale admin still succeeds) and bug 2 (append 2 line items, count rows, show
the total mismatch). With all flags OFF the same sequence must be clean.

## Report

Format from `docs/agent-briefs/_common.md` §7. Known limits must include
anything you deliberately left simple (the UI is server-rendered, no SPA).
