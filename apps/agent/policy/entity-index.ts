/**
 * Seed mirror used by the mock policy engine.
 * ---------------------------------------------------------------------------
 * Owned by agent 2b (apps/agent/**).
 *
 * WHY THIS EXISTS
 * The agent is a *policy* engine: it has to decide which tool to call before
 * it has any data, so it needs a resolution index (does "Priya Nair" mean
 * con_001? is dls_002 owned by the acting user? may an external actor read a
 * deal at all?). That index is a **mirror of the seeded demo data** described
 * in `docs/BUILD-CONTRACT.md` §3, plus a mirror of the seeded permission
 * matrix. It is fixture data: it is never presented to the user as an answer
 * and it never replaces a tool result. Every fact the agent *states* comes
 * from a tool result; this mirror only decides which tool to call and whether
 * the call is inside the actor's scope.
 *
 * The mirror is deliberately inert when the app disagrees with it: the agent
 * asks the app (`check_permissions`, scoped record reads) and records the
 * disagreement instead of silently trusting either side.
 */
import type { PersonaId, Role } from '../../../src/contracts/types.ts';
import { ROLE_OF_PERSONA } from '../../../src/contracts/app-api.ts';

// ---------------------------------------------------------------------------
// Seeded records (BUILD-CONTRACT §3)
// ---------------------------------------------------------------------------

export interface SeedCompany {
  id: string;
  name: string;
  industry: string;
  region: string;
}

export interface SeedContact {
  id: string;
  name: string;
  companyId: string;
  email: string;
  role: string;
}

export interface SeedDeal {
  id: string;
  title: string;
  companyId: string;
  ownerId: string;
  stage: 'qualification' | 'proposal' | 'negotiation' | 'won' | 'lost';
  amountCents: number;
  currency: string;
}

export const SEED_COMPANIES: readonly SeedCompany[] = [
  { id: 'cmp_acme', name: 'Acme Aerospace', industry: 'Aerospace', region: 'EU' },
  { id: 'cmp_bolt', name: 'Bolt Logistics', industry: 'Freight', region: 'EU' },
  { id: 'cmp_cedar', name: 'Cedar Health', industry: 'Healthcare', region: 'UK' },
  { id: 'cmp_delta', name: 'Delta Retail', industry: 'Retail', region: 'US' },
  { id: 'cmp_echo', name: 'Echo Financial', industry: 'Financial Services', region: 'US' },
];

export const SEED_CONTACTS: readonly SeedContact[] = [
  {
    id: 'con_001',
    name: 'Priya Nair',
    companyId: 'cmp_acme',
    email: 'priya.nair@acme-aerospace.example',
    role: 'Head of Maintenance',
  },
  {
    id: 'con_002',
    name: 'Marcus Webb',
    companyId: 'cmp_bolt',
    email: 'marcus.webb@boltlogistics.example',
    role: 'Fleet Manager',
  },
  {
    id: 'con_003',
    name: 'Ingrid Larsen',
    companyId: 'cmp_bolt',
    email: 'ingrid.larsen@boltlogistics.example',
    role: 'Procurement Lead',
  },
  {
    id: 'con_004',
    name: 'Alan Frost',
    companyId: 'cmp_cedar',
    email: 'alan.frost@cedarhealth.example',
    role: 'Clinic Operations Director',
  },
  {
    id: 'con_005',
    name: 'Grace Okafor',
    companyId: 'cmp_cedar',
    email: 'grace.okafor@cedarhealth.example',
    role: 'IT Manager',
  },
  {
    id: 'con_006',
    name: 'Tom Bradley',
    companyId: 'cmp_delta',
    email: 'tom.bradley@deltaretail.example',
    role: 'Merchandising Lead',
  },
  {
    id: 'con_007',
    name: 'Sara Lindqvist',
    companyId: 'cmp_delta',
    email: 'sara.lindqvist@deltaretail.example',
    role: 'Category Manager',
  },
  {
    id: 'con_008',
    name: 'Wei Chen',
    companyId: 'cmp_echo',
    email: 'wei.chen@echofinancial.example',
    role: 'Risk Analyst',
  },
  {
    id: 'con_009',
    name: 'Fatima Al-Sayed',
    companyId: 'cmp_echo',
    email: 'fatima.al-sayed@echofinancial.example',
    role: 'Compliance Officer',
  },
  {
    id: 'con_010',
    name: 'Jonas Weber',
    companyId: 'cmp_acme',
    email: 'jonas.weber@acme-aerospace.example',
    role: 'Spares Buyer',
  },
];

export const SEED_DEALS: readonly SeedDeal[] = [
  {
    id: 'dls_001',
    title: 'Predictive maintenance rollout',
    companyId: 'cmp_acme',
    ownerId: 'usr_liam',
    stage: 'negotiation',
    amountCents: 480000,
    currency: 'EUR',
  },
  {
    id: 'dls_002',
    title: 'Fleet telematics pilot',
    companyId: 'cmp_bolt',
    ownerId: 'usr_liam',
    stage: 'proposal',
    amountCents: 210000,
    currency: 'EUR',
  },
  {
    id: 'dls_003',
    title: 'Clinic scheduling module',
    companyId: 'cmp_cedar',
    ownerId: 'usr_viktor',
    stage: 'qualification',
    amountCents: 175000,
    currency: 'GBP',
  },
  {
    id: 'dls_004',
    title: 'Seasonal promotion campaign',
    companyId: 'cmp_delta',
    ownerId: 'usr_liam',
    stage: 'won',
    amountCents: 95000,
    currency: 'USD',
  },
  {
    id: 'dls_005',
    title: 'Risk reporting add-on',
    companyId: 'cmp_echo',
    ownerId: 'usr_viktor',
    stage: 'lost',
    amountCents: 132000,
    currency: 'USD',
  },
  {
    id: 'dls_006',
    title: 'Spares support contract',
    companyId: 'cmp_acme',
    ownerId: 'usr_liam',
    stage: 'proposal',
    amountCents: 64000,
    currency: 'EUR',
  },
  {
    id: 'dls_007',
    title: 'Loyalty pilot',
    companyId: 'cmp_delta',
    ownerId: 'usr_liam',
    stage: 'qualification',
    amountCents: 48000,
    currency: 'USD',
  },
  {
    id: 'dls_008',
    title: 'Data retention review',
    companyId: 'cmp_cedar',
    ownerId: 'usr_viktor',
    stage: 'negotiation',
    amountCents: 88000,
    currency: 'GBP',
  },
];

/** Seeded users, limited to the fields the policy needs for scoping. */
export const SEED_USERS: readonly {
  id: string;
  persona: PersonaId;
  role: Role;
  companyId: string | null;
  teamId: string | null;
}[] = [
  { id: 'usr_emma', persona: 'owner_emma', role: 'owner', companyId: null, teamId: null },
  { id: 'usr_viktor', persona: 'manager_viktor', role: 'admin', companyId: null, teamId: null },
  { id: 'usr_liam', persona: 'rep_liam', role: 'sales_rep', companyId: null, teamId: 'tm_alpha' },
  {
    id: 'usr_sofia',
    persona: 'support_sofia',
    role: 'support_agent',
    companyId: null,
    teamId: null,
  },
  { id: 'usr_raul', persona: 'auditor_raul', role: 'read_only', companyId: null, teamId: null },
  {
    id: 'usr_dana',
    persona: 'contractor_dana',
    role: 'external',
    companyId: 'cmp_echo',
    teamId: null,
  },
];

// ---------------------------------------------------------------------------
// Actor scope
// ---------------------------------------------------------------------------

export interface ActorScope {
  userId: string;
  role: Role;
  companyId: string | null;
  teamId: string | null;
}

export function actorScope(persona: PersonaId): ActorScope {
  const user = SEED_USERS.find((u) => u.persona === persona);
  if (!user) {
    // The persona list is frozen, so this is unreachable in practice; throwing
    // keeps a typo from silently widening an actor's scope.
    throw new Error(`Unknown persona: ${persona}`);
  }
  return {
    userId: user.id,
    role: ROLE_OF_PERSONA[persona],
    companyId: user.companyId,
    teamId: user.teamId,
  };
}

// ---------------------------------------------------------------------------
// Permission matrix mirror (BUILD-CONTRACT §3)
// ---------------------------------------------------------------------------

export type MatrixAction = 'read' | 'create' | 'update' | 'delete' | 'send-email';
export type MatrixResource = 'contact' | 'company' | 'deal' | 'line_item' | 'activity' | 'invoice';
export type MatrixScope = 'all' | 'own' | 'team' | 'company';

export interface MatrixRule {
  allowed: boolean;
  scope: MatrixScope;
}

const DENY: MatrixRule = { allowed: false, scope: 'all' };
const ALL: MatrixRule = { allowed: true, scope: 'all' };
const OWN: MatrixRule = { allowed: true, scope: 'own' };
const TEAM: MatrixRule = { allowed: true, scope: 'team' };
const COMPANY: MatrixRule = { allowed: true, scope: 'company' };

/**
 * Mirror of the seeded `permissions` table. Roles the matrix does not mention
 * for line items inherit the deal rules, because appending line items is a
 * write against the deal that owns them (the line-items endpoint is scoped by
 * deal, see the endpoint catalogue).
 */
export const PERMISSION_MATRIX: Record<
  Role,
  Partial<Record<MatrixAction, Partial<Record<MatrixResource, MatrixRule>>>>
> = {
  owner: {
    read: { contact: ALL, company: ALL, deal: ALL, line_item: ALL, activity: ALL, invoice: ALL },
    create: { contact: ALL, company: ALL, deal: ALL, line_item: ALL, activity: ALL, invoice: ALL },
    update: { contact: ALL, company: ALL, deal: ALL, line_item: ALL, activity: ALL, invoice: ALL },
    delete: { contact: ALL, company: ALL, deal: ALL, line_item: ALL, activity: ALL, invoice: ALL },
    'send-email': {
      contact: ALL,
      company: ALL,
      deal: ALL,
      line_item: ALL,
      activity: ALL,
      invoice: ALL,
    },
  },
  admin: {
    read: { contact: ALL, company: ALL, deal: ALL, line_item: ALL, activity: ALL, invoice: ALL },
    create: { contact: ALL, company: ALL, deal: ALL, line_item: ALL, activity: ALL, invoice: ALL },
    update: { contact: ALL, company: ALL, deal: ALL, line_item: ALL, activity: ALL, invoice: ALL },
    delete: {
      contact: DENY,
      company: DENY,
      deal: DENY,
      line_item: DENY,
      activity: DENY,
      invoice: DENY,
    },
    'send-email': {
      contact: ALL,
      company: ALL,
      deal: ALL,
      line_item: ALL,
      activity: ALL,
      invoice: ALL,
    },
  },
  sales_rep: {
    read: {
      contact: ALL,
      company: ALL,
      activity: ALL,
      deal: TEAM,
      line_item: TEAM,
      invoice: TEAM,
    },
    create: {
      contact: ALL,
      company: DENY,
      activity: ALL,
      deal: OWN,
      line_item: OWN,
      invoice: DENY,
    },
    update: {
      contact: ALL,
      company: DENY,
      activity: ALL,
      deal: OWN,
      line_item: OWN,
      invoice: DENY,
    },
    delete: {
      contact: DENY,
      company: DENY,
      deal: DENY,
      line_item: DENY,
      activity: DENY,
      invoice: DENY,
    },
    'send-email': {
      contact: ALL,
      company: ALL,
      deal: ALL,
      line_item: ALL,
      activity: ALL,
      invoice: ALL,
    },
  },
  support_agent: {
    read: {
      contact: ALL,
      company: ALL,
      activity: ALL,
      deal: DENY,
      line_item: DENY,
      invoice: DENY,
    },
    create: {
      contact: DENY,
      company: DENY,
      activity: ALL,
      deal: DENY,
      line_item: DENY,
      invoice: DENY,
    },
    update: {
      contact: ALL,
      company: DENY,
      activity: ALL,
      deal: DENY,
      line_item: DENY,
      invoice: DENY,
    },
    delete: {
      contact: DENY,
      company: DENY,
      deal: DENY,
      line_item: DENY,
      activity: DENY,
      invoice: DENY,
    },
    'send-email': {
      contact: ALL,
      company: ALL,
      deal: ALL,
      line_item: ALL,
      activity: ALL,
      invoice: ALL,
    },
  },
  read_only: {
    read: { contact: ALL, company: ALL, deal: ALL, line_item: ALL, activity: ALL, invoice: ALL },
    create: {
      contact: DENY,
      company: DENY,
      deal: DENY,
      line_item: DENY,
      activity: DENY,
      invoice: DENY,
    },
    update: {
      contact: DENY,
      company: DENY,
      deal: DENY,
      line_item: DENY,
      activity: DENY,
      invoice: DENY,
    },
    delete: {
      contact: DENY,
      company: DENY,
      deal: DENY,
      line_item: DENY,
      activity: DENY,
      invoice: DENY,
    },
    'send-email': {
      contact: DENY,
      company: DENY,
      deal: DENY,
      line_item: DENY,
      activity: DENY,
      invoice: DENY,
    },
  },
  external: {
    read: {
      contact: COMPANY,
      company: COMPANY,
      deal: DENY,
      line_item: DENY,
      activity: DENY,
      invoice: DENY,
    },
    create: {
      contact: DENY,
      company: DENY,
      deal: DENY,
      line_item: DENY,
      activity: DENY,
      invoice: DENY,
    },
    update: {
      contact: DENY,
      company: DENY,
      deal: DENY,
      line_item: DENY,
      activity: DENY,
      invoice: DENY,
    },
    delete: {
      contact: DENY,
      company: DENY,
      deal: DENY,
      line_item: DENY,
      activity: DENY,
      invoice: DENY,
    },
    'send-email': {
      contact: DENY,
      company: DENY,
      deal: DENY,
      line_item: DENY,
      activity: DENY,
      invoice: DENY,
    },
  },
};

/** The matrix verdict for a role/action/resource triple. */
export function matrixRule(role: Role, action: MatrixAction, resource: MatrixResource): MatrixRule {
  return PERMISSION_MATRIX[role][action]?.[resource] ?? DENY;
}

/** True when the rule allows the action and the record is inside the scope. */
export function matrixAllows(
  actor: ActorScope,
  action: MatrixAction,
  resource: MatrixResource,
  record?: { companyId?: string | null; ownerId?: string | null },
): boolean {
  const rule = matrixRule(actor.role, action, resource);
  if (!rule.allowed) return false;
  if (!record) return true;
  switch (rule.scope) {
    case 'all':
      return true;
    case 'company':
      return actor.companyId !== null && record.companyId === actor.companyId;
    case 'own':
      return record.ownerId !== undefined && record.ownerId === actor.userId;
    case 'team': {
      if (record.ownerId === undefined) return false;
      if (record.ownerId === actor.userId) return true;
      const owner = SEED_USERS.find((u) => u.id === record.ownerId);
      return actor.teamId !== null && owner?.teamId === actor.teamId;
    }
    default:
      return false;
  }
}
