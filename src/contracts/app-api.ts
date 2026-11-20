/**
 * FROZEN CONTRACT — the app-under-test's API surface and the agent's tools.
 * ---------------------------------------------------------------------------
 * Owned by the orchestrator. Both apps/under-test (implements this) and
 * apps/agent (calls this) import from here so they cannot drift apart.
 * Sub-agents: read-only. Request changes, never fork.
 */
import { z } from 'zod';
import type { DbSnapshot, PersonaId, Role, ToolName } from './types.ts';

// ---------------------------------------------------------------------------
// Record model
// ---------------------------------------------------------------------------

export const RECORD_TYPES = [
  'contact',
  'company',
  'deal',
  'activity',
  'invoice',
  'line_item',
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

/** Every record row carries these fields; the rest are per-type columns. */
export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export const CompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  industry: z.string(),
  region: z.string(),
});
export type Company = z.infer<typeof CompanySchema>;

export const ContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  companyId: z.string(),
  email: z.string(),
  phone: z.string(),
  role: z.string(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const DealSchema = z.object({
  id: z.string(),
  title: z.string(),
  companyId: z.string(),
  ownerId: z.string(),
  stage: z.enum(['qualification', 'proposal', 'negotiation', 'won', 'lost']),
  amountCents: z.number().int(),
  currency: z.string(),
});
export type Deal = z.infer<typeof DealSchema>;

export const LineItemSchema = z.object({
  id: z.string(),
  dealId: z.string(),
  product: z.string(),
  qty: z.number().int(),
  unitCents: z.number().int(),
  totalCents: z.number().int(),
});
export type LineItem = z.infer<typeof LineItemSchema>;

export const ActivitySchema = z.object({
  id: z.string(),
  type: z.enum(['call', 'meeting', 'note']),
  contactId: z.string(),
  dealId: z.string().nullable(),
  happenedOn: z.string(),
  notes: z.string(),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const InvoiceSchema = z.object({
  id: z.string(),
  dealId: z.string(),
  status: z.enum(['draft', 'sent', 'paid', 'overdue']),
  amountCents: z.number().int(),
  paidCents: z.number().int(),
  balanceCents: z.number().int(),
  currency: z.string(),
  dueOn: z.string(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const EmailSchema = z.object({
  id: z.string(),
  to: z.string(),
  subject: z.string(),
  body: z.string(),
  actorId: z.string(),
  sentAt: z.string(),
});
export type Email = z.infer<typeof EmailSchema>;

export const UserSchema = z.object({
  id: z.string(),
  persona: z.string(),
  name: z.string(),
  role: z.enum(['owner', 'admin', 'sales_rep', 'support_agent', 'read_only', 'external']),
  email: z.string(),
  companyId: z.string().nullable(),
  teamId: z.string().nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const PermissionSchema = z.object({
  role: z.string(),
  action: z.string(),
  resource: z.string(),
  allowed: z.boolean(),
  scope: z.enum(['all', 'own', 'team', 'company']),
});
export type PermissionRow = z.infer<typeof PermissionSchema>;

/** Snapshot tables, in fixed alphabetical order for deterministic output. */
export const DB_TABLES = [
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
export type DbTable = (typeof DB_TABLES)[number];

export const DbSnapshotSchema = z.object({
  tables: z.record(z.array(z.record(z.unknown()))),
}) satisfies z.ZodType<DbSnapshot>;

// ---------------------------------------------------------------------------
// The agent's six tools (frozen)
// ---------------------------------------------------------------------------

export const TOOL_NAMES: readonly ToolName[] = [
  'search_record',
  'create_record',
  'update_record',
  'send_email',
  'check_permissions',
  'summarise',
] as const;

export const SearchRecordArgs = z.object({
  type: z.enum(RECORD_TYPES).optional(),
  /** Free text or an exact record id. An id query returns the full record. */
  query: z.string(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const CreateRecordArgs = z.object({
  type: z.enum(RECORD_TYPES),
  fields: z.record(z.unknown()),
});

export const UpdateRecordArgs = z.object({
  type: z.enum(RECORD_TYPES),
  id: z.string(),
  fields: z.record(z.unknown()),
});

export const SendEmailArgs = z.object({
  to: z.string(),
  subject: z.string(),
  body: z.string(),
});

export const CheckPermissionsArgs = z.object({
  action: z.enum(['read', 'create', 'update', 'delete', 'send-email']),
  resource: z.string(),
});

export const SummariseArgs = z.object({
  instruction: z.string(),
  data: z.string(),
});

export const TOOL_SCHEMAS = {
  search_record: SearchRecordArgs,
  create_record: CreateRecordArgs,
  update_record: UpdateRecordArgs,
  send_email: SendEmailArgs,
  check_permissions: CheckPermissionsArgs,
  summarise: SummariseArgs,
} as const;

// ---------------------------------------------------------------------------
// REST surface (frozen)
// ---------------------------------------------------------------------------

export interface EndpointDoc {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  auth: 'x-actor-id header required' | 'x-actor-id header required (admin+)' | 'none';
  request: string;
  response: string;
  purpose: string;
}

/**
 * The catalogue every module codes against. The Express app in apps/under-test
 * implements exactly these routes and nothing else.
 */
export const ENDPOINTS: EndpointDoc[] = [
  {
    method: 'GET',
    path: '/health',
    auth: 'none',
    request: '—',
    response: '{ status: "ok", version: string, bugFlags: Record<string, boolean> }',
    purpose: 'Liveness probe used by CI and the eval runner before a suite starts.',
  },
  {
    method: 'GET',
    path: '/api/v1/records',
    auth: 'x-actor-id header required',
    request: 'query: type?, q?, limit?',
    response: '{ items: Record[], total: number }',
    purpose: 'List/search records. Company-scoped for role `external`.',
  },
  {
    method: 'GET',
    path: '/api/v1/records/:type/:id',
    auth: 'x-actor-id header required',
    request: '—',
    response: 'Record | 404 { error }',
    purpose: 'Fetch one record by id. 404 for records outside the actor scope.',
  },
  {
    method: 'POST',
    path: '/api/v1/records/:type',
    auth: 'x-actor-id header required',
    request: 'JSON body of record fields',
    response: '201 Record | 403 { error }',
    purpose: 'Create a record. Enforced against the seeded permission matrix.',
  },
  {
    method: 'PATCH',
    path: '/api/v1/records/:type/:id',
    auth: 'x-actor-id header required',
    request: 'JSON body of partial fields',
    response: '200 Record | 403 | 404',
    purpose: 'Update a record. Enforced against the seeded permission matrix.',
  },
  {
    method: 'GET',
    path: '/api/v1/deals/:id/line-items',
    auth: 'x-actor-id header required',
    request: '—',
    response: '{ items: LineItem[] }',
    purpose: 'Line items of a deal — used by the consistency checks.',
  },
  {
    method: 'POST',
    path: '/api/v1/deals/:id/line-items',
    auth: 'x-actor-id header required',
    request: '{ items: { product, qty, unitCents }[] }',
    response: '201 { items: LineItem[] } | 403',
    purpose: 'Append line items to a deal. Surface for the partial-write bug.',
  },
  {
    method: 'GET',
    path: '/api/v1/permissions/check',
    auth: 'x-actor-id header required',
    request: 'query: action, resource',
    response: '{ allowed: boolean, role: string, reason: string }',
    purpose: 'check_permissions tool backend. Surface for the stale-role bug.',
  },
  {
    method: 'POST',
    path: '/api/v1/emails',
    auth: 'x-actor-id header required',
    request: '{ to, subject, body }',
    response: '201 Email | 403',
    purpose: 'Append to the outbox. send_email tool backend; PII assertions read it.',
  },
  {
    method: 'GET',
    path: '/api/v1/emails',
    auth: 'x-actor-id header required',
    request: 'query: to?',
    response: '{ items: Email[] }',
    purpose: 'Read the outbox — the only way outbound mail is observed.',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/demote',
    auth: 'x-actor-id header required (admin+)',
    request: '{ userId: string }',
    response: '200 User',
    purpose: 'Demote a user one level. Used to open the stale-role-cache window.',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/promote',
    auth: 'x-actor-id header required (admin+)',
    request: '{ userId: string }',
    response: '200 User',
    purpose: 'Undo a demotion (used by seed reset, not by scenarios).',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/bugs',
    auth: 'none',
    request: '—',
    response: 'Record<string, boolean>',
    purpose: 'Read the latent-bug flags. The runner sets these per suite.',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/bugs',
    auth: 'none',
    request: 'Record<string, boolean>',
    response: 'Record<string, boolean>',
    purpose: 'Set latent-bug flags. `--hardened` disables all of them.',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/snapshot',
    auth: 'none',
    request: '—',
    response: 'DbSnapshot (all tables, alphabetical, rows sorted by id)',
    purpose: 'db_before/db_after capture for the verifier and the transcripts.',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/restore',
    auth: 'none',
    request: 'DbSnapshot',
    response: '{ ok: true }',
    purpose: 'Restore a snapshot (Playwright DB checkpoint/restore).',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/reset',
    auth: 'none',
    request: '—',
    response: '{ ok: true, seeded: true }',
    purpose: 'Drop + re-seed deterministically. Called before every scenario.',
  },
  {
    method: 'GET',
    path: '/ui',
    auth: 'x-actor-id header required',
    request: '—',
    response: 'HTML page (server-rendered)',
    purpose: 'The only UI: role switcher, record list, record detail, create form.',
  },
];

// ---------------------------------------------------------------------------
// Demo-grade auth
// ---------------------------------------------------------------------------

/**
 * The app authenticates with a demo header, exactly as the runner and
 * Playwright set it. This is a deliberate trade-off (see docs/DECISIONS.md):
 * a real OIDC flow adds no QA signal and costs hours of flake.
 */
export const ACTOR_HEADER = 'x-actor-id';

export const PERSONA_USER_IDS: Record<PersonaId, string> = {
  owner_emma: 'usr_emma',
  manager_viktor: 'usr_viktor',
  rep_liam: 'usr_liam',
  support_sofia: 'usr_sofia',
  auditor_raul: 'usr_raul',
  contractor_dana: 'usr_dana',
};

export const ROLE_OF_PERSONA: Record<PersonaId, Role> = {
  owner_emma: 'owner',
  manager_viktor: 'admin',
  rep_liam: 'sales_rep',
  support_sofia: 'support_agent',
  auditor_raul: 'read_only',
  contractor_dana: 'external',
};

/** Human-readable environment string stamped on every ticket. */
export function describeEnvironment(): string {
  return `agent-qa-lab offline deterministic (node ${process.version}, provider mock-policy-1, bugs on)`;
}
