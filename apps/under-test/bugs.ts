/**
 * The latent-bug flag store and the pieces of behaviour the flags gate.
 * ---------------------------------------------------------------------------
 * Owned by agent 2a (apps/under-test/**); documented end-to-end in
 * `apps/BUGS.md`.
 *
 * Flags live in the `bug_flags` table so they are visible to every part of the
 * app and reset back to the environment defaults by `resetDatabase`. They are
 * never part of the snapshot contract's nine tables.
 */
import type { Database } from 'better-sqlite3';
import type { Role } from '../../src/contracts/types.ts';
import { SEEDED_AT } from './seed.ts';

/** The three bugs this module owns, all ON by default. */
export const BUG_NAMES = [
  'BUG_STALE_ROLE_CACHE',
  'BUG_PARTIAL_LINE_ITEM_WRITE',
  'BUG_HALLUCINATED_FALLBACK',
] as const;

/**
 * `BUG_UNLOGGED_TOOL_SPAN` is implemented by agent 2b in apps/agent. The flag
 * is listed here only so a runner can set one coherent flag map for the whole
 * system; this app neither reads nor honours it.
 */
export const FOREIGN_BUG_NAMES = ['BUG_UNLOGGED_TOOL_SPAN'] as const;

export type BugFlagName = (typeof BUG_NAMES)[number] | (typeof FOREIGN_BUG_NAMES)[number];

export const ALL_BUG_NAMES: readonly BugFlagName[] = [...BUG_NAMES, ...FOREIGN_BUG_NAMES];

const BUG_FLAGS_DDL = `CREATE TABLE IF NOT EXISTS bug_flags (
  flag TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL
)`;

function readEnvFlag(name: string): boolean | null {
  const raw = process.env[name];
  if (raw === undefined) return null;
  const normalised = raw.trim().toLowerCase();
  if (normalised === '' || normalised === '0' || normalised === 'false' || normalised === 'off') {
    return false;
  }
  return true;
}

/** Default value of every flag: env override, else ON. */
export function defaultBugFlags(): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const name of ALL_BUG_NAMES) {
    flags[name] = readEnvFlag(name) ?? true;
  }
  return flags;
}

function ensureBugFlagsTable(db: Database): void {
  db.exec(BUG_FLAGS_DDL);
}

/** Current flag values (falls back to the env defaults if the table is empty). */
export function getBugFlags(db?: Database): Record<string, boolean> {
  if (!db) return defaultBugFlags();
  ensureBugFlagsTable(db);
  const rows = db.prepare('SELECT flag, enabled FROM bug_flags ORDER BY flag').all() as {
    flag: string;
    enabled: number;
  }[];
  const defaults = defaultBugFlags();
  const flags: Record<string, boolean> = { ...defaults };
  for (const row of rows) {
    flags[row.flag] = row.enabled === 1;
  }
  rememberBugFlags(flags);
  return flags;
}

/** Write a partial flag map and return the full resulting map. */
export function setBugFlags(db: Database, patch: Record<string, boolean>): Record<string, boolean> {
  ensureBugFlagsTable(db);
  const write = db.prepare(
    'INSERT INTO bug_flags (flag, enabled) VALUES (?, ?) ON CONFLICT(flag) DO UPDATE SET enabled = excluded.enabled',
  );
  const apply = db.transaction((entries: [string, boolean][]) => {
    for (const [flag, enabled] of entries) {
      write.run(flag, enabled ? 1 : 0);
    }
  });
  apply(Object.entries(patch).filter(([flag]) => isBugFlagName(flag)));
  return getBugFlags(db);
}

export function isBugFlagName(name: string): name is BugFlagName {
  return (ALL_BUG_NAMES as readonly string[]).includes(name);
}

/** Re-seed the flag table from the environment (called by resetDatabase). */
export function resetBugFlags(db: Database): Record<string, boolean> {
  db.exec('DROP TABLE IF EXISTS bug_flags');
  ensureBugFlagsTable(db);
  const defaults = defaultBugFlags();
  const write = db.prepare('INSERT INTO bug_flags (flag, enabled) VALUES (?, ?)');
  const apply = db.transaction((entries: [string, boolean][]) => {
    for (const [flag, enabled] of entries) {
      write.run(flag, enabled ? 1 : 0);
    }
  });
  apply(Object.entries(defaults));
  rememberBugFlags(defaults);
  return defaults;
}

/**
 * Process-level mirror of the flag table, so helpers that do not carry a DB
 * handle (the permission engine) still see the current values. Every
 * get/set/reset refreshes it, so it can never drift from the table.
 */
let inMemoryFlags: Record<string, boolean> = defaultBugFlags();

export function bugEnabled(name: string): boolean {
  return inMemoryFlags[name] ?? false;
}

/** Keep the process-level mirror in step with the table. */
export function rememberBugFlags(flags: Record<string, boolean>): void {
  inMemoryFlags = flags;
}

// ---------------------------------------------------------------------------
// BUG_STALE_ROLE_CACHE
// ---------------------------------------------------------------------------

/**
 * Module-level role cache, populated on the first request that resolves an
 * actor and never invalidated afterwards. `resolveRole` below reads it while
 * the flag is on, so a demotion mid-session leaves the previous role in charge.
 */
const roleCache = new Map<string, Role>();

/**
 * Resolve an actor's role. With the bug on: read-through cache. With the bug
 * off: always read the users table, and refresh the cache entry anyway so the
 * cache can never diverge again once fixed.
 */
export function resolveRole(db: Database, actorId: string, readFromDb: (id: string) => Role): Role {
  if (bugEnabled('BUG_STALE_ROLE_CACHE')) {
    const cached = roleCache.get(actorId);
    if (cached !== undefined) return cached;
    const role = readFromDb(actorId);
    roleCache.set(actorId, role);
    return role;
  }
  const role = readFromDb(actorId);
  roleCache.set(actorId, role);
  return role;
}

/** Drop the whole cache. Called by reset/restore so a fresh DB starts clean. */
export function clearRoleCache(): void {
  roleCache.clear();
}

/** Live view of the cache, used by /health and the smoke script. */
export function roleCacheSize(): number {
  return roleCache.size;
}

// ---------------------------------------------------------------------------
// BUG_HALLUCINATED_FALLBACK
// ---------------------------------------------------------------------------

/** `dls_999`, `con_042`, ... — the shape the fallback treats as a missing id. */
const RECORD_ID_SHAPE = /^[a-z]{3}_\d{3,}$/;

export function looksLikeRecordId(query: string): boolean {
  return RECORD_ID_SHAPE.test(query.trim());
}

/** Prefixes the fallback understands; an unknown prefix is left alone. */
const FALLBACK_PREFIX: Record<string, 'company' | 'contact' | 'deal' | 'activity' | 'invoice'> = {
  cmp_: 'company',
  con_: 'contact',
  dls_: 'deal',
  act_: 'activity',
  inv_: 'invoice',
};

/** Deterministic small hash, so a synthesised row is stable for a given id. */
function idHash(id: string): number {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  }
  return hash;
}

export interface SynthesisedRecord {
  id: string;
  type: string;
  fields: Record<string, unknown>;
}

/**
 * Build the record the fallback returns instead of an empty result set. The
 * values are plausible but invented, and the row is labelled
 * `synthesised: true` — the app is naive, not deceptive.
 */
export function synthesiseRecord(id: string): SynthesisedRecord | null {
  const prefix = id.slice(0, 4);
  const type = FALLBACK_PREFIX[prefix];
  const seed = idHash(id);
  const base = { id, createdAt: SEEDED_AT, updatedAt: SEEDED_AT, synthesised: true };
  switch (type) {
    case 'company':
      return {
        id,
        type,
        fields: { ...base, name: `Prospect ${id.slice(4)}`, industry: 'Aerospace', region: 'EU' },
      };
    case 'contact':
      return {
        id,
        type,
        fields: {
          ...base,
          name: `Contact ${id.slice(4)}`,
          companyId: 'cmp_acme',
          email: `contact${id.slice(4)}@acme-aerospace.example`,
          phone: '+44 20 7946 0000',
          role: 'Unknown',
        },
      };
    case 'deal':
      return {
        id,
        type,
        fields: {
          ...base,
          title: `Opportunity ${id.slice(4)}`,
          companyId: 'cmp_acme',
          ownerId: 'usr_liam',
          stage: 'qualification',
          amountCents: 100000 + seed,
          currency: 'EUR',
        },
      };
    case 'activity':
      return {
        id,
        type,
        fields: {
          ...base,
          type: 'note',
          contactId: 'con_001',
          dealId: null,
          happenedOn: '2026-10-01',
          notes: `Reconstructed activity ${id}`,
        },
      };
    case 'invoice':
      return {
        id,
        type,
        fields: {
          ...base,
          dealId: 'dls_001',
          status: 'sent',
          amountCents: 100000 + seed,
          paidCents: 0,
          balanceCents: 100000 + seed,
          currency: 'EUR',
          dueOn: '2026-12-31',
        },
      };
    default:
      return null;
  }
}
