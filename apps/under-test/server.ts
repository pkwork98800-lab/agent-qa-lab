/**
 * Process entry point for the app under test.
 * ---------------------------------------------------------------------------
 * Owned by agent 2a (apps/under-test/**).
 *
 * `startServer` boots the Express app (createApp) over a seeded in-memory
 * SQLite database and returns a handle the eval runner and Playwright can use.
 * Run directly with `npm run app:dev` or `npx tsx apps/under-test/server.ts`.
 *
 * Port resolution: explicit argument > APP_PORT env > PLAYWRIGHT_APP_PORT env >
 * 4799.
 */
import { createApp } from './app.ts';
import { closeDb, getSharedDb, resetDatabase } from './db.ts';
import type { Express } from 'express';
import { pathToFileURL } from 'node:url';

export function startServer(opts: { port?: number } = {}): {
  url: string;
  close: () => void;
  app: Express;
} {
  const resolvedPort =
    opts.port ?? Number(process.env.APP_PORT ?? process.env.PLAYWRIGHT_APP_PORT ?? 4799);

  const database = getSharedDb();
  resetDatabase(database); // seed the deterministic demo data
  const app = createApp(database);

  const server = app.listen(resolvedPort, () => {
    console.log(`app under test listening on http://127.0.0.1:${String(resolvedPort)}`);
  });

  const url = `http://127.0.0.1:${String(resolvedPort)}`;
  const close = (): void => {
    server.close();
    closeDb(database);
  };
  return { url, close, app };
}

// CLI entry point: boot and listen until the process is killed.
if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  startServer({});
}
