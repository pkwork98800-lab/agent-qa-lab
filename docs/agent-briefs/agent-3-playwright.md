# Agent 3 — Playwright framework (UI + API regression layer)

You own: `framework/playwright/**`.
You do NOT own: `apps/**` (read + run it), `package.json`, `src/contracts/**`
(read-only), `scenarios/**`.

## Context

Read `docs/BUILD-CONTRACT.md` (§3 seed, §4 auth+ports, §5 assertion semantics).
The app under test is agent 2a's Express + SQLite mini-CRM with a
server-rendered `/ui` and the REST API in `src/contracts/app-api.ts`. Your
layer proves the harness can also test the app the way a human QA does:
through the UI, through the API, across every role.

## Deliverables

### `framework/playwright/playwright.config.ts`

- ESM, `testDir: './tests'`, `fullyParallel: false` (DB is shared per server),
  `reporters: [['list'], ['json', { outputFile: '../../runs/latest/playwright-results.json' }]]`.
- `webServer: { command: 'npx tsx apps/under-test/server.ts', port: 4731,
reuseExistingServer: false, env: { PLAYWRIGHT_APP_PORT: '4731' } }` (agent 2a's
  server reads the port from env — if it does not, coordinate via your report).
- Projects: `ui` (chromium, `testMatch: '**/ui/*.spec.ts'`) and `api`
  (`testMatch: '**/api/*.spec.ts'`, no browser needed).
- `timeout: 30000`, `expect: { timeout: 5000 }`.

### `framework/playwright/fixtures.ts`

- `app` fixture: boots nothing (the webServer does), exposes `baseUrl` and
  `api(actorId)` — a thin typed helper over the REST API (fetch-based, no
  Playwright request needed for API project; use `request` fixture there).
- `resetDb` fixture: `beforeEach` → `POST /api/v1/admin/reset`; after each test
  the DB is reset again (no cross-test bleed).
- `checkpoint` fixture: snapshot before a test, restore after — demonstrates
  the snapshot/restore discipline the plan asks for.
- `asUser(userId)` sets the `x-actor-id` header for API calls.

### `framework/playwright/pages/`

Page objects for the real UI: `RoleSwitcherPage` (select demo actor), `RecordsPage`
(list + search box), `RecordDetailPage`, `CreateContactPage`, `OutboxPage`.
No CSS selectors that depend on styling; use roles/labels/text like a user
would. Export them from an `index.ts`.

### `framework/playwright/tests/ui/`

- `roles.spec.ts` — each of the 6 seeded roles: what the UI shows/hides
  (read_only: no create form; external: only Echo-scoped records).
- `records.spec.ts` — list, search by name, open detail, happy-path create
  (as liam), and a denied create (as raul) showing the server's 403 message.
- `outbox.spec.ts` — send an email as sofia, see it in the outbox list.

### `framework/playwright/tests/api/`

- `crud.spec.ts` — create/patch/read contacts + deals through the API, assert
  status codes and field values.
- `permission-matrix.spec.ts` — **the same action attempted as 5 roles with 5
  expected outcomes** (read contact: all allow except external gets 404 for a
  non-Echo contact; create contact: liam/sofia... use the BUILD-CONTRACT §3
  matrix: sales_rep create contact allow, support_agent deny, read_only deny,
  external deny, owner allow). One clean table-driven spec.
- `consistency.spec.ts` — append 2 line items to `dls_006` as liam, then GET
  the deal + line items and assert `amountCents == SUM(totalCents)` and the row
  count. **With the default bug flags this test FAILS — that is the point**;
  mark it `test.fixme`-free: write it as a real assertion and let it fail, but
  add a comment naming `BUG_PARTIAL_LINE_ITEM_WRITE` and how to see it pass
  (`BUG_PARTIAL_LINE_ITEM_WRITE=0`). Check `apps/under-test` for how flags are
  read (env or endpoint) and use that mechanism.

### `framework/playwright/README.md`

What it does, how to run it alone (`npx playwright test --config
framework/playwright/playwright.config.ts`), inputs, outputs.

## Acceptance (run these, paste output)

```bash
npx playwright test --config framework/playwright/playwright.config.ts --list
npx playwright test --config framework/playwright/playwright.config.ts api/crud.spec.ts
npx playwright test --config framework/playwright/playwright.config.ts ui/roles.spec.ts
```

Chromium is already installed (`npx playwright install chromium` was run). If
agent 2a's app is not running yet, coordinate: your webServer boots it
automatically, so a missing app is a blocker to report.

## Report

Format from `docs/agent-briefs/_common.md` §7. Known limits: name any spec that
depends on bug-flag state and how a reviewer sees both outcomes.
