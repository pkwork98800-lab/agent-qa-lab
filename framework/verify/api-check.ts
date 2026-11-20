/**
 * Independent API checks (agent 6, api-check).
 * ---------------------------------------------------------------------------
 * Bypasses the agent entirely and talks to the app over HTTP:
 *
 *  - Re-GET every record the agent claims to have created/updated, asserting
 *    the response fields match the stored data (catches UI-only / cache-only
 *    bugs).
 *  - Permission probes: for a sample of role × action pairs, call the API with
 *    the right `x-actor-id` and assert allow/deny per the seeded matrix.
 *  - Cross-scope probe: `usr_dana` (external, cmp_echo) GETs another
 *    company's contact → must be 404.
 */
import type { DbSnapshot, Role, RunResult } from '../../src/contracts/types.ts';
import { PERSONA_USER_IDS } from '../../src/contracts/app-api.ts';
import type { ApiCheckResult } from './index.ts';

/** Role → user id, inverted so each role can be addressed over the API. */
const ROLE_TO_PERSONA: Record<Role, string> = {
  owner: PERSONA_USER_IDS.owner_emma,
  admin: PERSONA_USER_IDS.manager_viktor,
  sales_rep: PERSONA_USER_IDS.rep_liam,
  support_agent: PERSONA_USER_IDS.support_sofia,
  read_only: PERSONA_USER_IDS.auditor_raul,
  external: PERSONA_USER_IDS.contractor_dana,
};

export interface Probe {
  role: Role;
  action: string;
  resource: string;
  expected: 'allow' | 'deny';
}

/** Representative role × action × resource probes from BUILD-CONTRACT §3. */
export const PERMISSION_PROBES: Probe[] = [
  { role: 'owner', action: 'read', resource: 'contact', expected: 'allow' },
  { role: 'admin', action: 'read', resource: 'contact', expected: 'allow' },
  { role: 'sales_rep', action: 'read', resource: 'contact', expected: 'allow' },
  { role: 'support_agent', action: 'read', resource: 'contact', expected: 'allow' },
  { role: 'read_only', action: 'read', resource: 'contact', expected: 'allow' },
  { role: 'external', action: 'read', resource: 'contact', expected: 'allow' },
  { role: 'sales_rep', action: 'update', resource: 'deal', expected: 'allow' },
  { role: 'support_agent', action: 'update', resource: 'deal', expected: 'deny' },
  { role: 'read_only', action: 'update', resource: 'deal', expected: 'deny' },
  { role: 'external', action: 'update', resource: 'deal', expected: 'deny' },
  { role: 'admin', action: 'delete', resource: 'deal', expected: 'deny' },
  { role: 'sales_rep', action: 'delete', resource: 'deal', expected: 'deny' },
  { role: 'read_only', action: 'create', resource: 'contact', expected: 'deny' },
  { role: 'external', action: 'create', resource: 'contact', expected: 'deny' },
];

/** Cross-scope: an external user reading another company's record → 404. */
export const CROSS_SCOPE_PROBES: Array<{ actorId: string; path: string; expectedStatus: number }> =
  [
    {
      actorId: PERSONA_USER_IDS.contractor_dana,
      path: '/api/v1/records/contact/con_002',
      expectedStatus: 404,
    },
  ];

interface RawResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

async function fetchJson(
  baseUrl: string,
  path: string,
  actorId: string,
  method = 'GET',
  body?: unknown,
): Promise<RawResponse> {
  const headers: Record<string, string> = { 'x-actor-id': actorId };
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (cause) {
    return { status: 0, ok: false, body: cause instanceof Error ? cause.message : String(cause) };
  }
  let parsed: unknown = null;
  try {
    const text = await res.text();
    parsed = text.trim() === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: res.status, ok: res.ok, body: parsed };
}

/** Row keyed by id from a snapshot table. */
function rowOf(
  snapshot: DbSnapshot,
  table: string,
  id: string,
): Record<string, unknown> | undefined {
  return (snapshot.tables[table] ?? []).find((r) => String(r.id) === id);
}

function tableOf(type: string): string {
  const map: Record<string, string> = {
    company: 'companies',
    contact: 'contacts',
    deal: 'deals',
    activity: 'activities',
    invoice: 'invoices',
    line_item: 'line_items',
  };
  return map[type] ?? type;
}

/**
 * Run the independent API checks for one run.
 *
 * `actorId` is the run's own persona (used to re-GET the records it claimed to
 * touch).
 */
export async function runApiChecks(
  run: RunResult,
  baseUrl: string,
  actorId: string,
  _verifierActorId: string,
): Promise<ApiCheckResult[]> {
  const checks: ApiCheckResult[] = [];

  // 1. Re-GET every record the agent claims to have created or updated.
  for (const call of run.toolsCalled) {
    if (call.name !== 'create_record' && call.name !== 'update_record') continue;
    if (!call.ok) continue;
    const type = String(call.args.type);
    const id =
      call.name === 'update_record'
        ? String(call.args.id)
        : (((call.args as { id?: unknown }).id as string | undefined) ?? '');
    if (!id) continue;
    const table = tableOf(type);
    const stored = rowOf(run.dbAfter, table, id);
    const check = await fetchJson(baseUrl, `/api/v1/records/${type}/${id}`, actorId);
    const expectedStatus = 200;
    const ok = check.status === expectedStatus && fieldsMatch(check.body, stored);
    checks.push({
      method: 'GET',
      path: `/api/v1/records/${type}/${id}`,
      actorId,
      status: check.status,
      ok,
      expectedStatus,
      body: check.body,
      error: ok
        ? undefined
        : check.status !== expectedStatus
          ? `HTTP ${String(check.status)}`
          : 'fields do not match stored data',
    });
  }

  // 2. Permission probes across roles.
  for (const probe of PERMISSION_PROBES) {
    const probeActor = ROLE_TO_PERSONA[probe.role];
    if (!probeActor) continue;
    const check = await fetchJson(
      baseUrl,
      `/api/v1/permissions/check?action=${encodeURIComponent(probe.action)}&resource=${encodeURIComponent(probe.resource)}`,
      probeActor,
    );
    const allowed =
      typeof check.body === 'object' &&
      check.body !== null &&
      (check.body as { allowed?: unknown }).allowed === true;
    const actual: 'allow' | 'deny' = allowed ? 'allow' : 'deny';
    checks.push({
      method: 'GET',
      path: `/api/v1/permissions/check?action=${probe.action}&resource=${probe.resource}`,
      actorId: probeActor,
      status: check.status,
      ok: check.status === 200 && actual === probe.expected,
      expectedStatus: 200,
      body: check.body,
      error:
        check.status !== 200
          ? `HTTP ${String(check.status)}`
          : `expected ${probe.expected}, got ${actual}`,
    });
  }

  // 3. Cross-scope probe: usr_dana reads another company's contact → 404.
  for (const probe of CROSS_SCOPE_PROBES) {
    const check = await fetchJson(baseUrl, probe.path, probe.actorId);
    const ok = check.status === probe.expectedStatus;
    checks.push({
      method: 'GET',
      path: probe.path,
      actorId: probe.actorId,
      status: check.status,
      ok,
      expectedStatus: probe.expectedStatus,
      body: check.body,
      error: ok
        ? undefined
        : `expected ${String(probe.expectedStatus)}, got ${String(check.status)}`,
    });
  }

  return checks;
}

function fieldsMatch(response: unknown, stored: Record<string, unknown> | undefined): boolean {
  if (!stored) return false;
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return false;
  const body = response as Record<string, unknown>;
  for (const [key, value] of Object.entries(stored)) {
    if (key === 'createdAt' || key === 'updatedAt') continue;
    if (JSON.stringify(body[key]) !== JSON.stringify(value)) return false;
  }
  return true;
}

export { fetchJson };
