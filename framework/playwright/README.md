# Playwright framework — agent 3

UI + API regression layer for the mini-CRM app under test. Runs against the
real server (booted by the `webServer` on port 4731) through the browser for
UI specs and through plain `fetch` for API specs.

## What it does

- **UI project** (`tests/ui/`): Chromium tests through the server-rendered
  `/ui`. Role visibility, record list/search/detail, contact create, outbox.
- **API project** (`tests/api/`): Fetch-based tests against the REST API. CRUD,
  permission matrix, data consistency (exposes `BUG_PARTIAL_LINE_ITEM_WRITE`).
- Each test resets the seeded database before and after via
  `POST /api/v1/admin/reset`, so there is no cross-test bleed.

## How to run it alone

From the repo root:

```bash
npx playwright test --config framework/playwright/playwright.config.ts
```

Run one project:

```bash
npx playwright test --config framework/playwright/playwright.config.ts --project=ui
npx playwright test --config framework/playwright/playwright.config.ts --project=api
```

List all tests:

```bash
npx playwright test --config framework/playwright/playwright.config.ts --list
```

Run a single spec:

```bash
npx playwright test --config framework/playwright/playwright.config.ts api/crud.spec.ts
npx playwright test --config framework/playwright/playwright.config.ts ui/roles.spec.ts
```

The app under test is booted automatically by `webServer` (command:
`npx tsx apps/under-test/server.ts`, port 4731). You do not need to start it
first.

## Inputs

- Seeded demo data from `apps/under-test/seed.ts` (users, contacts, deals,
  line items, activities, invoices, permissions). Reset before every test.
- Latent bug flags from `apps/under-test/bugs.ts` (all ON by default). The
  consistency spec names `BUG_PARTIAL_LINE_ITEM_WRITE` and documents how to
  disable it to see both outcomes.

## Outputs

- Test runner output to stdout (list reporter).
- JSON results to `runs/latest/playwright-results.json` (json reporter).
- Traces retained on failure (`trace: 'retain-on-failure'`).

## Page objects

`framework/playwright/pages/index.ts` exports:
`RoleSwitcherPage`, `RecordsPage`, `RecordDetailPage`, `CreateContactPage`,
`OutboxPage`.

## Fixtures

`framework/playwright/fixtures.ts` exports:
`api(actorId)` — fetch-based REST client with `x-actor-id`,
`resetDb()` — POST /api/v1/admin/reset,
`checkpoint` — snapshot/restore via /api/v1/admin/snapshot + /restore,
`asUser(userId)` — x-actor-id header helper.

## Known limits

- `tests/api/consistency.spec.ts` fails with the default bug flags ON
  (`BUG_PARTIAL_LINE_ITEM_WRITE`). Disable the flag via
  `POST /api/v1/admin/bugs { "BUG_PARTIAL_LINE_ITEM_WRITE": false }` or the
  environment variable to see it pass.
- `tests/ui/outbox.spec.ts` verifies the outbox through the API (the server-rendered
  `/ui` does not render an outbox page).
- The `api()` fixture only accepts seeded user ids (`usr_emma`, `usr_viktor`,
  `usr_liam`, `usr_sofia`, `usr_raul`, `usr_dana`).
