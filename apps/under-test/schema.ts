/**
 * SQLite schema for the mini-CRM app under test.
 * ---------------------------------------------------------------------------
 * Owned by agent 2a (apps/under-test/**).
 *
 * Column naming: camelCase, identical to the TypeScript field names in
 * `src/contracts/app-api.ts` (`amountCents` <-> `amountCents`). That is a
 * deliberate choice — it means a snapshot row is already a contract-shaped
 * record and the verifier never has to snake_case/camelCase-map anything.
 * The one documented exception is SQLite's lack of a boolean type: the
 * `permissions.allowed` column is an INTEGER (0/1) and is mapped back to a
 * boolean by the row readers in `db.ts`.
 *
 * Every record table also carries `createdAt`/`updatedAt` (see `BaseRecord`).
 * Those two columns are deliberately NOT part of the per-type zod schemas, so
 * API responses stay exactly contract-shaped while snapshots stay richer.
 */
import type { Database } from 'better-sqlite3';

/** The nine tables the snapshot contract enumerates, in alphabetical order. */
export const TABLES = [
  'activities',
  'companies',
  'contacts',
  'deals',
  'invoices',
  'line_items',
  'outbox',
  'permissions',
  'users',
] as const;
export type Table = (typeof TABLES)[number];

/**
 * Insert order that satisfies the declared foreign keys (companies before the
 * users that reference them, deals before their line items).
 */
export const INSERT_ORDER: Table[] = [
  'companies',
  'users',
  'contacts',
  'deals',
  'line_items',
  'activities',
  'invoices',
  'permissions',
  'outbox',
];

/** Column list per table, in the order rows are read back out. */
export const TABLE_COLUMNS: Record<Table, readonly string[]> = {
  users: [
    'id',
    'persona',
    'name',
    'role',
    'email',
    'companyId',
    'teamId',
    'createdAt',
    'updatedAt',
  ],
  companies: ['id', 'name', 'industry', 'region', 'createdAt', 'updatedAt'],
  contacts: ['id', 'name', 'companyId', 'email', 'phone', 'role', 'createdAt', 'updatedAt'],
  deals: [
    'id',
    'title',
    'companyId',
    'ownerId',
    'stage',
    'amountCents',
    'currency',
    'createdAt',
    'updatedAt',
  ],
  line_items: [
    'id',
    'dealId',
    'product',
    'qty',
    'unitCents',
    'totalCents',
    'createdAt',
    'updatedAt',
  ],
  activities: [
    'id',
    'type',
    'contactId',
    'dealId',
    'happenedOn',
    'notes',
    'createdAt',
    'updatedAt',
  ],
  invoices: [
    'id',
    'dealId',
    'status',
    'amountCents',
    'paidCents',
    'balanceCents',
    'currency',
    'dueOn',
    'createdAt',
    'updatedAt',
  ],
  outbox: ['id', 'to', 'subject', 'body', 'actorId', 'sentAt', 'createdAt', 'updatedAt'],
  permissions: ['role', 'action', 'resource', 'allowed', 'scope'],
};

/** Sort key per table: rows are ordered by id, except the permission matrix. */
export const TABLE_ORDER_BY: Record<Table, string> = {
  users: 'id',
  companies: 'id',
  contacts: 'id',
  deals: 'id',
  line_items: 'id',
  activities: 'id',
  invoices: 'id',
  outbox: 'id',
  permissions: 'role, action, resource',
};

/** Id prefixes used by `nextId` for server-generated ids. */
export const ID_PREFIX: Record<Table, string> = {
  users: 'usr_',
  companies: 'cmp_',
  contacts: 'con_',
  deals: 'dls_',
  line_items: 'dli_',
  activities: 'act_',
  invoices: 'inv_',
  outbox: 'eml_',
  permissions: '',
};

export const DDL: string[] = [
  `CREATE TABLE users (
    id TEXT PRIMARY KEY,
    persona TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    email TEXT NOT NULL,
    companyId TEXT REFERENCES companies(id),
    teamId TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    industry TEXT NOT NULL,
    region TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    companyId TEXT NOT NULL REFERENCES companies(id),
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    role TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE deals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    companyId TEXT NOT NULL REFERENCES companies(id),
    ownerId TEXT NOT NULL REFERENCES users(id),
    stage TEXT NOT NULL,
    amountCents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE line_items (
    id TEXT PRIMARY KEY,
    dealId TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    product TEXT NOT NULL,
    qty INTEGER NOT NULL,
    unitCents INTEGER NOT NULL,
    totalCents INTEGER NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE activities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    contactId TEXT NOT NULL REFERENCES contacts(id),
    dealId TEXT REFERENCES deals(id),
    happenedOn TEXT NOT NULL,
    notes TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    dealId TEXT NOT NULL REFERENCES deals(id),
    status TEXT NOT NULL,
    amountCents INTEGER NOT NULL,
    paidCents INTEGER NOT NULL,
    balanceCents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    dueOn TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE outbox (
    id TEXT PRIMARY KEY,
    "to" TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    actorId TEXT NOT NULL REFERENCES users(id),
    sentAt TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE permissions (
    role TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    allowed INTEGER NOT NULL,
    scope TEXT NOT NULL,
    PRIMARY KEY (role, action, resource)
  )`,
  `CREATE INDEX idx_contacts_company ON contacts(companyId)`,
  `CREATE INDEX idx_deals_owner ON deals(ownerId)`,
  `CREATE INDEX idx_line_items_deal ON line_items(dealId)`,
  `CREATE INDEX idx_activities_contact ON activities(contactId)`,
  `CREATE INDEX idx_invoices_deal ON invoices(dealId)`,
  `CREATE INDEX idx_outbox_actor ON outbox(actorId)`,
];

/** Enforce foreign keys on this connection and create the tables. */
export function createSchema(db: Database): void {
  db.pragma('foreign_keys = ON');
  for (const statement of DDL) {
    db.exec(statement);
  }
}

/** Drop every table (indexes go with them). Used by reset + restore. */
export function dropSchema(db: Database): void {
  db.pragma('foreign_keys = OFF');
  for (const table of [...TABLES].reverse()) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  db.pragma('foreign_keys = ON');
}

/** True when `name` names one of the nine snapshot tables. */
export function isTable(name: string): name is Table {
  return (TABLES as readonly string[]).includes(name);
}
