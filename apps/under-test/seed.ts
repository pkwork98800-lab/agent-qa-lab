/**
 * Seed data for the mini-CRM app under test — BUILD-CONTRACT §3, verbatim.
 * ---------------------------------------------------------------------------
 * Owned by agent 2a (apps/under-test/**).
 *
 * Every id, name, amount and permission row here is fixed: scenario files and
 * tests reference these ids, and `npm run app:reset` must reproduce the same
 * database byte-for-byte. Nothing in this file may read the clock.
 */
import type { BaseRecord } from '../../src/contracts/app-api.ts';
import type {
  Activity,
  Company,
  Contact,
  Deal,
  Email,
  Invoice,
  LineItem,
  PermissionRow,
  User,
} from '../../src/contracts/app-api.ts';

/** Fixed stamp applied to every seeded row. No wall-clock time anywhere. */
export const SEEDED_AT = '2026-11-01T09:00:00.000Z';

const at = () => ({ createdAt: SEEDED_AT, updatedAt: SEEDED_AT });

export type SeedUser = User & BaseRecord;
export type SeedCompany = Company & BaseRecord;
export type SeedContact = Contact & BaseRecord;
export type SeedDeal = Deal & BaseRecord;
export type SeedLineItem = LineItem & BaseRecord;
export type SeedActivity = Activity & BaseRecord;
export type SeedInvoice = Invoice & BaseRecord;
export type SeedEmail = Email & BaseRecord;

export const SEED_USERS: SeedUser[] = [
  {
    id: 'usr_emma',
    persona: 'owner_emma',
    name: 'Emma Adeyemi',
    role: 'owner',
    email: 'emma.adeyemi@northwind.example',
    companyId: null,
    teamId: null,
    ...at(),
  },
  {
    id: 'usr_viktor',
    persona: 'manager_viktor',
    name: 'Viktor Halvorsen',
    role: 'admin',
    email: 'viktor.halvorsen@northwind.example',
    companyId: null,
    teamId: null,
    ...at(),
  },
  {
    id: 'usr_liam',
    persona: 'rep_liam',
    name: 'Liam Trent',
    role: 'sales_rep',
    email: 'liam.trent@northwind.example',
    companyId: null,
    teamId: 'tm_alpha',
    ...at(),
  },
  {
    id: 'usr_sofia',
    persona: 'support_sofia',
    name: 'Sofia Marchetti',
    role: 'support_agent',
    email: 'sofia.marchetti@northwind.example',
    companyId: null,
    teamId: null,
    ...at(),
  },
  {
    id: 'usr_raul',
    persona: 'auditor_raul',
    name: 'Raul Duarte',
    role: 'read_only',
    email: 'raul.duarte@northwind.example',
    companyId: null,
    teamId: null,
    ...at(),
  },
  {
    id: 'usr_dana',
    persona: 'contractor_dana',
    name: 'Dana Whitlock',
    role: 'external',
    email: 'dana.whitlock@echofinancial.example',
    companyId: 'cmp_echo',
    teamId: null,
    ...at(),
  },
];

export const SEED_COMPANIES: SeedCompany[] = [
  { id: 'cmp_acme', name: 'Acme Aerospace', industry: 'Aerospace', region: 'EU', ...at() },
  { id: 'cmp_bolt', name: 'Bolt Logistics', industry: 'Freight', region: 'EU', ...at() },
  { id: 'cmp_cedar', name: 'Cedar Health', industry: 'Healthcare', region: 'UK', ...at() },
  { id: 'cmp_delta', name: 'Delta Retail', industry: 'Retail', region: 'US', ...at() },
  {
    id: 'cmp_echo',
    name: 'Echo Financial',
    industry: 'Financial Services',
    region: 'US',
    ...at(),
  },
];

export const SEED_CONTACTS: SeedContact[] = [
  {
    id: 'con_001',
    name: 'Priya Nair',
    companyId: 'cmp_acme',
    email: 'priya.nair@acme-aerospace.example',
    phone: '+44 20 7946 0011',
    role: 'Head of Maintenance',
    ...at(),
  },
  {
    id: 'con_002',
    name: 'Marcus Webb',
    companyId: 'cmp_bolt',
    email: 'marcus.webb@boltlogistics.example',
    phone: '+44 20 7946 0012',
    role: 'Fleet Manager',
    ...at(),
  },
  {
    id: 'con_003',
    name: 'Ingrid Larsen',
    companyId: 'cmp_bolt',
    email: 'ingrid.larsen@boltlogistics.example',
    phone: '+44 20 7946 0013',
    role: 'Procurement Lead',
    ...at(),
  },
  {
    id: 'con_004',
    name: 'Alan Frost',
    companyId: 'cmp_cedar',
    email: 'alan.frost@cedarhealth.example',
    phone: '+44 20 7946 0014',
    role: 'Clinic Operations Director',
    ...at(),
  },
  {
    id: 'con_005',
    name: 'Grace Okafor',
    companyId: 'cmp_cedar',
    email: 'grace.okafor@cedarhealth.example',
    phone: '+44 20 7946 0015',
    role: 'IT Manager',
    ...at(),
  },
  {
    id: 'con_006',
    name: 'Tom Bradley',
    companyId: 'cmp_delta',
    email: 'tom.bradley@deltaretail.example',
    phone: '+1 415 555 0006',
    role: 'Merchandising Lead',
    ...at(),
  },
  {
    id: 'con_007',
    name: 'Sara Lindqvist',
    companyId: 'cmp_delta',
    email: 'sara.lindqvist@deltaretail.example',
    phone: '+1 415 555 0007',
    role: 'Category Manager',
    ...at(),
  },
  {
    id: 'con_008',
    name: 'Wei Chen',
    companyId: 'cmp_echo',
    email: 'wei.chen@echofinancial.example',
    phone: '+1 415 555 0008',
    role: 'Risk Analyst',
    ...at(),
  },
  {
    id: 'con_009',
    name: 'Fatima Al-Sayed',
    companyId: 'cmp_echo',
    email: 'fatima.al-sayed@echofinancial.example',
    phone: '+1 415 555 0009',
    role: 'Compliance Officer',
    ...at(),
  },
  {
    id: 'con_010',
    name: 'Jonas Weber',
    companyId: 'cmp_acme',
    email: 'jonas.weber@acme-aerospace.example',
    phone: '+44 20 7946 0010',
    role: 'Spares Buyer',
    ...at(),
  },
];

export const SEED_DEALS: SeedDeal[] = [
  {
    id: 'dls_001',
    title: 'Predictive maintenance rollout',
    companyId: 'cmp_acme',
    ownerId: 'usr_liam',
    stage: 'negotiation',
    amountCents: 480000,
    currency: 'EUR',
    ...at(),
  },
  {
    id: 'dls_002',
    title: 'Fleet telematics pilot',
    companyId: 'cmp_bolt',
    ownerId: 'usr_liam',
    stage: 'proposal',
    amountCents: 210000,
    currency: 'EUR',
    ...at(),
  },
  {
    id: 'dls_003',
    title: 'Clinic scheduling module',
    companyId: 'cmp_cedar',
    ownerId: 'usr_viktor',
    stage: 'qualification',
    amountCents: 175000,
    currency: 'GBP',
    ...at(),
  },
  {
    id: 'dls_004',
    title: 'Seasonal promotion campaign',
    companyId: 'cmp_delta',
    ownerId: 'usr_liam',
    stage: 'won',
    amountCents: 95000,
    currency: 'USD',
    ...at(),
  },
  {
    id: 'dls_005',
    title: 'Risk reporting add-on',
    companyId: 'cmp_echo',
    ownerId: 'usr_viktor',
    stage: 'lost',
    amountCents: 132000,
    currency: 'USD',
    ...at(),
  },
  {
    id: 'dls_006',
    title: 'Spares support contract',
    companyId: 'cmp_acme',
    ownerId: 'usr_liam',
    stage: 'proposal',
    amountCents: 64000,
    currency: 'EUR',
    ...at(),
  },
  {
    id: 'dls_007',
    title: 'Loyalty pilot',
    companyId: 'cmp_delta',
    ownerId: 'usr_liam',
    stage: 'qualification',
    amountCents: 48000,
    currency: 'USD',
    ...at(),
  },
  {
    id: 'dls_008',
    title: 'Data retention review',
    companyId: 'cmp_cedar',
    ownerId: 'usr_viktor',
    stage: 'negotiation',
    amountCents: 88000,
    currency: 'GBP',
    ...at(),
  },
];

export const SEED_LINE_ITEMS: SeedLineItem[] = [
  // dls_001 — 240000 + 120000 + 120000 = 480000
  {
    id: 'dli_001',
    dealId: 'dls_001',
    product: 'Telemetry sensors',
    qty: 20,
    unitCents: 12000,
    totalCents: 240000,
    ...at(),
  },
  {
    id: 'dli_002',
    dealId: 'dls_001',
    product: 'Edge gateway',
    qty: 4,
    unitCents: 30000,
    totalCents: 120000,
    ...at(),
  },
  {
    id: 'dli_003',
    dealId: 'dls_001',
    product: 'Installation services',
    qty: 1,
    unitCents: 120000,
    totalCents: 120000,
    ...at(),
  },
  // dls_002 — 150000 + 60000 = 210000
  {
    id: 'dli_004',
    dealId: 'dls_002',
    product: 'Telematics devices',
    qty: 30,
    unitCents: 5000,
    totalCents: 150000,
    ...at(),
  },
  {
    id: 'dli_005',
    dealId: 'dls_002',
    product: 'Platform seats',
    qty: 10,
    unitCents: 6000,
    totalCents: 60000,
    ...at(),
  },
  // dls_003 — 100000 + 75000 = 175000
  {
    id: 'dli_006',
    dealId: 'dls_003',
    product: 'Scheduling licences',
    qty: 25,
    unitCents: 4000,
    totalCents: 100000,
    ...at(),
  },
  {
    id: 'dli_007',
    dealId: 'dls_003',
    product: 'Integration services',
    qty: 1,
    unitCents: 75000,
    totalCents: 75000,
    ...at(),
  },
  // dls_004 — 45000 + 50000 = 95000
  {
    id: 'dli_008',
    dealId: 'dls_004',
    product: 'Campaign creative',
    qty: 1,
    unitCents: 45000,
    totalCents: 45000,
    ...at(),
  },
  {
    id: 'dli_009',
    dealId: 'dls_004',
    product: 'Media placement',
    qty: 1,
    unitCents: 50000,
    totalCents: 50000,
    ...at(),
  },
  // dls_005 — 80000 + 52000 = 132000
  {
    id: 'dli_010',
    dealId: 'dls_005',
    product: 'Risk dashboards',
    qty: 4,
    unitCents: 20000,
    totalCents: 80000,
    ...at(),
  },
  {
    id: 'dli_011',
    dealId: 'dls_005',
    product: 'Data connectors',
    qty: 2,
    unitCents: 26000,
    totalCents: 52000,
    ...at(),
  },
  // dls_006 — 48000 + 16000 = 64000
  {
    id: 'dli_012',
    dealId: 'dls_006',
    product: 'Support tier: business',
    qty: 1,
    unitCents: 48000,
    totalCents: 48000,
    ...at(),
  },
  {
    id: 'dli_013',
    dealId: 'dls_006',
    product: 'Spare parts kit',
    qty: 2,
    unitCents: 8000,
    totalCents: 16000,
    ...at(),
  },
  // dls_007 — 30000 + 18000 = 48000
  {
    id: 'dli_014',
    dealId: 'dls_007',
    product: 'Loyalty pilot licences',
    qty: 6,
    unitCents: 5000,
    totalCents: 30000,
    ...at(),
  },
  {
    id: 'dli_015',
    dealId: 'dls_007',
    product: 'Onboarding workshop',
    qty: 1,
    unitCents: 18000,
    totalCents: 18000,
    ...at(),
  },
  // dls_008 — 60000 + 28000 = 88000
  {
    id: 'dli_016',
    dealId: 'dls_008',
    product: 'Retention audit',
    qty: 1,
    unitCents: 60000,
    totalCents: 60000,
    ...at(),
  },
  {
    id: 'dli_017',
    dealId: 'dls_008',
    product: 'Remediation plan',
    qty: 1,
    unitCents: 28000,
    totalCents: 28000,
    ...at(),
  },
];

export const SEED_ACTIVITIES: SeedActivity[] = [
  {
    id: 'act_001',
    type: 'call',
    contactId: 'con_001',
    dealId: 'dls_001',
    happenedOn: '2026-10-06',
    notes:
      'Priya asked for the sensor firmware release notes ahead of the pilot sign-off; promised to circulate them internally.',
    ...at(),
  },
  {
    id: 'act_002',
    type: 'meeting',
    contactId: 'con_004',
    dealId: 'dls_003',
    happenedOn: '2026-10-08',
    notes:
      'Walked the clinic scheduling team through the integration plan and agreed a cutover window in the second week of November.',
    ...at(),
  },
  {
    id: 'act_003',
    type: 'note',
    contactId: 'con_002',
    dealId: 'dls_002',
    happenedOn: '2026-10-12',
    notes:
      'Marcus confirmed the telematics pilot scope: 30 devices, one depot, a four week window.',
    ...at(),
  },
  {
    id: 'act_004',
    type: 'call',
    contactId: 'con_006',
    dealId: 'dls_004',
    happenedOn: '2026-10-15',
    notes:
      'Tom approved the seasonal promotion creative and asked for the media placement dates in writing.',
    ...at(),
  },
  {
    id: 'act_005',
    type: 'note',
    contactId: 'con_008',
    dealId: 'dls_005',
    happenedOn: '2026-10-19',
    notes:
      'Wei shared the risk dashboard requirements. Deal parked after their budget review; revisit in January.',
    ...at(),
  },
  {
    id: 'act_006',
    type: 'meeting',
    contactId: 'con_010',
    dealId: 'dls_006',
    happenedOn: '2026-10-22',
    notes: 'Jonas reviewed the spares support contract terms and the two spare-part kits.',
    ...at(),
  },
];

export const SEED_INVOICES: SeedInvoice[] = [
  {
    id: 'inv_001',
    dealId: 'dls_004',
    status: 'paid',
    amountCents: 95000,
    paidCents: 95000,
    balanceCents: 0,
    currency: 'USD',
    dueOn: '2026-11-01',
    ...at(),
  },
  {
    id: 'inv_002',
    dealId: 'dls_001',
    status: 'sent',
    amountCents: 480000,
    paidCents: 0,
    balanceCents: 480000,
    currency: 'EUR',
    dueOn: '2026-12-01',
    ...at(),
  },
  {
    id: 'inv_003',
    dealId: 'dls_006',
    status: 'draft',
    amountCents: 64000,
    paidCents: 0,
    balanceCents: 64000,
    currency: 'EUR',
    dueOn: '2026-12-15',
    ...at(),
  },
  {
    id: 'inv_004',
    dealId: 'dls_002',
    status: 'overdue',
    amountCents: 210000,
    paidCents: 60000,
    balanceCents: 150000,
    currency: 'EUR',
    dueOn: '2026-10-31',
    ...at(),
  },
];

/** §3: the outbox starts empty. */
export const SEED_EMAILS: SeedEmail[] = [];

/**
 * §3 permission matrix. Rows are looked up as (role, action, resource) first and
 * fall back to a `*` wildcard row, so an unlisted resource inherits the role's
 * catch-all behaviour instead of silently denying.
 */
export const SEED_PERMISSIONS: PermissionRow[] = [
  // ---- owner: everything, scope all -------------------------------------
  { role: 'owner', action: 'read', resource: '*', allowed: true, scope: 'all' },
  { role: 'owner', action: 'create', resource: '*', allowed: true, scope: 'all' },
  { role: 'owner', action: 'update', resource: '*', allowed: true, scope: 'all' },
  { role: 'owner', action: 'delete', resource: '*', allowed: true, scope: 'all' },
  { role: 'owner', action: 'send-email', resource: '*', allowed: true, scope: 'all' },
  // ---- admin: everything except delete ----------------------------------
  { role: 'admin', action: 'read', resource: '*', allowed: true, scope: 'all' },
  { role: 'admin', action: 'create', resource: '*', allowed: true, scope: 'all' },
  { role: 'admin', action: 'update', resource: '*', allowed: true, scope: 'all' },
  { role: 'admin', action: 'delete', resource: '*', allowed: false, scope: 'all' },
  { role: 'admin', action: 'send-email', resource: '*', allowed: true, scope: 'all' },
  // ---- sales_rep --------------------------------------------------------
  { role: 'sales_rep', action: 'read', resource: 'contact', allowed: true, scope: 'all' },
  { role: 'sales_rep', action: 'read', resource: 'company', allowed: true, scope: 'all' },
  { role: 'sales_rep', action: 'read', resource: 'activity', allowed: true, scope: 'all' },
  { role: 'sales_rep', action: 'read', resource: 'deal', allowed: true, scope: 'team' },
  { role: 'sales_rep', action: 'read', resource: 'line_item', allowed: true, scope: 'team' },
  { role: 'sales_rep', action: 'read', resource: 'invoice', allowed: true, scope: 'team' },
  { role: 'sales_rep', action: 'create', resource: 'contact', allowed: true, scope: 'all' },
  { role: 'sales_rep', action: 'create', resource: 'deal', allowed: true, scope: 'own' },
  { role: 'sales_rep', action: 'create', resource: 'activity', allowed: true, scope: 'all' },
  { role: 'sales_rep', action: 'update', resource: 'contact', allowed: true, scope: 'all' },
  { role: 'sales_rep', action: 'update', resource: 'deal', allowed: true, scope: 'own' },
  { role: 'sales_rep', action: 'update', resource: 'line_item', allowed: true, scope: 'own' },
  { role: 'sales_rep', action: 'update', resource: 'activity', allowed: true, scope: 'all' },
  { role: 'sales_rep', action: 'delete', resource: '*', allowed: false, scope: 'all' },
  { role: 'sales_rep', action: 'send-email', resource: '*', allowed: true, scope: 'all' },
  // ---- support_agent ----------------------------------------------------
  { role: 'support_agent', action: 'read', resource: 'contact', allowed: true, scope: 'all' },
  { role: 'support_agent', action: 'read', resource: 'company', allowed: true, scope: 'all' },
  { role: 'support_agent', action: 'read', resource: 'activity', allowed: true, scope: 'all' },
  { role: 'support_agent', action: 'read', resource: 'deal', allowed: false, scope: 'all' },
  { role: 'support_agent', action: 'read', resource: 'invoice', allowed: false, scope: 'all' },
  { role: 'support_agent', action: 'create', resource: 'activity', allowed: true, scope: 'all' },
  { role: 'support_agent', action: 'update', resource: 'contact', allowed: true, scope: 'all' },
  { role: 'support_agent', action: 'update', resource: 'activity', allowed: true, scope: 'all' },
  { role: 'support_agent', action: 'delete', resource: '*', allowed: false, scope: 'all' },
  { role: 'support_agent', action: 'send-email', resource: '*', allowed: true, scope: 'all' },
  // ---- read_only: reads everything, writes nothing ----------------------
  { role: 'read_only', action: 'read', resource: '*', allowed: true, scope: 'all' },
  { role: 'read_only', action: 'create', resource: '*', allowed: false, scope: 'all' },
  { role: 'read_only', action: 'update', resource: '*', allowed: false, scope: 'all' },
  { role: 'read_only', action: 'delete', resource: '*', allowed: false, scope: 'all' },
  { role: 'read_only', action: 'send-email', resource: '*', allowed: false, scope: 'all' },
  // ---- external: contacts and companies of its own company --------------
  { role: 'external', action: 'read', resource: 'contact', allowed: true, scope: 'company' },
  { role: 'external', action: 'read', resource: 'company', allowed: true, scope: 'company' },
  { role: 'external', action: 'read', resource: '*', allowed: false, scope: 'company' },
  { role: 'external', action: 'create', resource: '*', allowed: false, scope: 'company' },
  { role: 'external', action: 'update', resource: '*', allowed: false, scope: 'company' },
  { role: 'external', action: 'delete', resource: '*', allowed: false, scope: 'company' },
  { role: 'external', action: 'send-email', resource: '*', allowed: false, scope: 'company' },
];

/** The whole seed as one plain object, so tests can assert against it. */
export const SEED = {
  users: SEED_USERS,
  companies: SEED_COMPANIES,
  contacts: SEED_CONTACTS,
  deals: SEED_DEALS,
  lineItems: SEED_LINE_ITEMS,
  activities: SEED_ACTIVITIES,
  invoices: SEED_INVOICES,
  emails: SEED_EMAILS,
  permissions: SEED_PERMISSIONS,
} as const;

/**
 * Cheap self-check run at every reset: line items must sum to their deal total
 * and invoice balances must equal amount - paid. Throws before any row lands,
 * so a bad edit to this file can never reach a scenario.
 */
export function assertSeedConsistent(): void {
  const problems: string[] = [];

  for (const deal of SEED_DEALS) {
    const sum = SEED_LINE_ITEMS.filter((li) => li.dealId === deal.id).reduce(
      (acc, li) => acc + li.totalCents,
      0,
    );
    if (sum !== deal.amountCents) {
      problems.push(
        `deal ${deal.id}: amountCents ${String(deal.amountCents)} != line items sum ${String(sum)}`,
      );
    }
    for (const li of SEED_LINE_ITEMS.filter((item) => item.dealId === deal.id)) {
      if (li.qty * li.unitCents !== li.totalCents) {
        problems.push(`line item ${li.id}: qty*unitCents != totalCents`);
      }
    }
  }
  for (const invoice of SEED_INVOICES) {
    if (invoice.amountCents - invoice.paidCents !== invoice.balanceCents) {
      problems.push(`invoice ${invoice.id}: balanceCents != amountCents - paidCents`);
    }
  }
  const orphanLineItems = SEED_LINE_ITEMS.filter(
    (li) => !SEED_DEALS.some((d) => d.id === li.dealId),
  );
  if (orphanLineItems.length > 0) {
    problems.push(`orphan line items: ${orphanLineItems.map((li) => li.id).join(', ')}`);
  }
  if (problems.length > 0) {
    throw new Error(`seed is internally inconsistent:\n${problems.join('\n')}`);
  }
}

/** Human-readable seed inventory, printed by the seed CLI. */
export function describeSeed(): string {
  const lines = [
    `users ${String(SEED_USERS.length)}`,
    `companies ${String(SEED_COMPANIES.length)}`,
    `contacts ${String(SEED_CONTACTS.length)}`,
    `deals ${String(SEED_DEALS.length)}`,
    `line_items ${String(SEED_LINE_ITEMS.length)}`,
    `activities ${String(SEED_ACTIVITIES.length)}`,
    `invoices ${String(SEED_INVOICES.length)}`,
    `permissions ${String(SEED_PERMISSIONS.length)}`,
    `outbox ${String(SEED_EMAILS.length)}`,
  ];
  return lines.join(' · ');
}

/** Ids the seed expects, for the README's "inputs" section. */
export const SEED_IDS = {
  users: SEED_USERS.map((u) => u.id),
  companies: SEED_COMPANIES.map((c) => c.id),
  contacts: SEED_CONTACTS.map((c) => c.id),
  deals: SEED_DEALS.map((d) => d.id),
  lineItems: SEED_LINE_ITEMS.map((li) => li.id),
  activities: SEED_ACTIVITIES.map((a) => a.id),
  invoices: SEED_INVOICES.map((i) => i.id),
} as const;
