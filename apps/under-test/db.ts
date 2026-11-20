/**
 * better-sqlite3 wrapper: open, seed, reset, snapshot, restore, bug flags.
 * ---------------------------------------------------------------------------
 * Owned by agent 2a (apps/under-test/**).
 *
 * Everything is synchronous and deterministic. Two consequences worth naming:
 *
 * 1. `createdAt`/`updatedAt` come from a logical clock that starts at the seed
 *    stamp and advances one second per write. Two identical runs therefore
 *    produce identical snapshots — no `Date.now()` anywhere in this module.
 * 2. `snapshotDatabase` returns the nine contract tables in alphabetical order
 *    with rows sorted by id (the permission matrix sorts by role/action/
 *    resource), which is exactly what `docs/BUILD-CONTRACT.md` §3 asks for.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { DbSnapshot } from '../../src/contracts/types.ts';
import { resetBugFlags, getBugFlags, setBugFlags, clearRoleCache } from './bugs.ts';
import {
  INSERT_ORDER,
  TABLES,
  TABLE_COLUMNS,
  TABLE_ORDER_BY,
  createSchema,
  dropSchema,
  isTable,
  type Table,
} from './schema.ts';
import {
  SEED_ACTIVITIES,
  SEED_COMPANIES,
  SEED_CONTACTS,
  SEED_DEALS,
  SEED_EMAILS,
  SEED_INVOICES,
  SEED_LINE_ITEMS,
  SEED_PERMISSIONS,
  SEED_USERS,
  assertSeedConsistent,
} from './seed.ts';

/** Where a file-backed database lives when the caller does not say. */
export const DEFAULT_DB_PATH = fileURLToPath(new URL('./data/crm.db', import.meta.url));

/** File path for CLI entry points; in-memory when used as a library. */
export function resolveDbPath(): string {
  return process.env.APP_DB_PATH ?? DEFAULT_DB_PATH;
}

/** A single row as the rest of the app sees it. */
export type Row = Record<string, unknown>;

/** better-sqlite3 returns `unknown[]`; narrow once, in one place. */
function asRows(value: unknown): Row[] {
  return value as Row[];
}

function asRow(value: unknown): Row {
  return value as Row;
}

// ---------------------------------------------------------------------------
// Logical clock (deterministic timestamps)
// ---------------------------------------------------------------------------

const CLOCK_BASE_MS = Date.parse('2026-11-01T09:00:00.000Z');
let clockTicks = 0;

/** Next deterministic timestamp: seed stamp + one second per write. */
export function nextTimestamp(): string {
  clockTicks += 1;
  return new Date(CLOCK_BASE_MS + clockTicks * 1000).toISOString();
}

function resetClock(): void {
  clockTicks = 0;
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

/** Open (and schema-create) a database. In-memory unless a path is given. */
export function openDb(path?: string): Database.Database {
  const target = path ?? ':memory:';
  if (target !== ':memory:') {
    mkdirSync(dirname(target), { recursive: true });
  }
  const db = new Database(target);
  return db;
}

export function closeDb(db: Database.Database): void {
  db.close();
}

// ---------------------------------------------------------------------------
// Row access
// ---------------------------------------------------------------------------

/** Read one row of a table, normalised to the contract field types. */
export function findRow(db: Database.Database, table: Table, id: string): Row | null {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  return row === undefined ? null : normaliseRow(table, asRow(row));
}

/** Read a whole table in snapshot order (id ascending). */
export function listRows(db: Database.Database, table: Table): Row[] {
  const rows = asRows(db.prepare(`SELECT * FROM ${table} ORDER BY ${TABLE_ORDER_BY[table]}`).all());
  return rows.map((row) => normaliseRow(table, row));
}

function normaliseRow(table: Table, row: Row): Row {
  if (table !== 'permissions') return row;
  return { ...row, allowed: row.allowed === 1 || row.allowed === true };
}

/** Insert a row given exact column names; returns the stored, normalised row. */
/** Convert a JS value to something better-sqlite3 can bind (booleans -> 0/1). */
function bindValue(value: unknown): string | number | bigint | Buffer | null {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value as string | number | bigint | Buffer | null;
}

export function insertRow(db: Database.Database, table: Table, values: Row): Row {
  const columns = TABLE_COLUMNS[table];
  const present = columns.filter((column) => values[column] !== undefined);
  const placeholders = present.map(() => '?').join(', ');
  const stmt = db.prepare(
    `INSERT INTO ${table} (${present.map((c) => `\`${c}\``).join(', ')}) VALUES (${placeholders})`,
  );
  stmt.run(...present.map((column) => bindValue(values[column])));
  return normaliseRow(table, values);
}

/** Update a row by id; returns the stored, normalised row. */
export function updateRow(db: Database.Database, table: Table, id: string, patch: Row): Row {
  const columns = TABLE_COLUMNS[table].filter((column) => patch[column] !== undefined);
  if (columns.length === 0) {
    const existing = findRow(db, table, id);
    if (!existing) throw new Error(`row ${id} not found in ${table}`);
    return existing;
  }
  const assignments = columns.map((column) => `\`${column}\` = ?`).join(', ');
  db.prepare(`UPDATE ${table} SET ${assignments} WHERE id = ?`).run(
    ...columns.map((column) => bindValue(patch[column])),
    id,
  );
  const existing = findRow(db, table, id);
  if (!existing) throw new Error(`row ${id} not found in ${table}`);
  return existing;
}

/** Next id for a table: `con_011` after `con_010`, zero padded to three. */
export function nextId(db: Database.Database, table: Table, prefix: string): string {
  const rows = asRows(db.prepare(`SELECT id FROM ${table} WHERE id LIKE ?`).all(`${prefix}%`));
  let max = 0;
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id : '';
    const suffix = Number.parseInt(id.slice(prefix.length), 10);
    if (Number.isFinite(suffix) && suffix > max) max = suffix;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export function findUser(db: Database.Database, id: string): Row | null {
  return findRow(db, 'users', id);
}

export function listUsers(db: Database.Database): Row[] {
  return listRows(db, 'users');
}

// ---------------------------------------------------------------------------
// Seed / reset
// ---------------------------------------------------------------------------

/** Insert the seed rows into an already-created schema. */
export function insertSeed(db: Database.Database): void {
  assertSeedConsistent();
  const seedRows: Record<Table, Row[]> = {
    users: SEED_USERS as unknown as Row[],
    companies: SEED_COMPANIES as unknown as Row[],
    contacts: SEED_CONTACTS as unknown as Row[],
    deals: SEED_DEALS as unknown as Row[],
    line_items: SEED_LINE_ITEMS as unknown as Row[],
    activities: SEED_ACTIVITIES as unknown as Row[],
    invoices: SEED_INVOICES as unknown as Row[],
    permissions: SEED_PERMISSIONS,
    outbox: SEED_EMAILS as unknown as Row[],
  };
  const apply = db.transaction(() => {
    for (const table of INSERT_ORDER) {
      for (const row of seedRows[table]) {
        insertRow(db, table, row);
      }
    }
  });
  apply();
}

/** Seed the database in place (schema must already exist). */
export function seedDatabase(db: Database.Database): void {
  resetClock();
  clearRoleCache();
  insertSeed(db);
}

/** Drop every tables, recreate the schema, re-insert the seed. */
export function resetDatabase(db?: Database.Database): void {
  const target = db ?? getSharedDb();
  // foreign_keys cannot be toggled inside a transaction, so switch it off
  // before we drop tables (which have FK references between them).
  target.pragma('foreign_keys = OFF');
  const apply = target.transaction(() => {
    dropSchema(target);
    createSchema(target);
  });
  apply();
  target.pragma('foreign_keys = ON');
  resetBugFlags(target);
  seedDatabase(target);
  target.pragma('foreign_keys = OFF');
}

/**
 * The process-level default connection. Opened on first use from
 * `APP_DB_PATH`, falling back to a file next to this module so CLI runs
 * (`npm run app:reset`) leave a database behind that a later
 * `npm run app:dev` can serve.
 */
let sharedDb: Database.Database | null = null;

export function getSharedDb(): Database.Database {
  if (sharedDb === null || !sharedDb.open) {
    sharedDb = openDb(resolveDbPath());
  }
  return sharedDb;
}

// ---------------------------------------------------------------------------
// Snapshot / restore
// ---------------------------------------------------------------------------

/** All nine tables, alphabetical, rows sorted by id. */
export function snapshotDatabase(db?: Database.Database): DbSnapshot {
  const target = db ?? getSharedDb();
  const tables: Record<string, Row[]> = {};
  for (const table of TABLES) {
    tables[table] = listRows(target, table);
  }
  return { tables };
}

/** Row count for one table — used by the smoke script and the UI. */
export function countRows(db: Database.Database, table: string): number {
  if (!isTable(table)) throw new Error(`unknown table ${table}`);
  const result = asRow(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get());
  return typeof result.n === 'number' ? result.n : 0;
}

/** Replace the whole database with a snapshot (Playwright checkpoint/restore). */
export function restoreDatabase(db: Database.Database, snapshot: DbSnapshot): void {
  // foreign_keys cannot be toggled inside a transaction.
  db.pragma('foreign_keys = OFF');
  const apply = db.transaction(() => {
    dropSchema(db);
    createSchema(db);
    for (const table of INSERT_ORDER) {
      const rows = snapshot.tables[table];
      for (const row of rows) {
        insertRow(db, table, row);
      }
    }
  });
  apply();
  db.pragma('foreign_keys = ON');
  resetClock();
  clearRoleCache();
}

export { getBugFlags, setBugFlags };
