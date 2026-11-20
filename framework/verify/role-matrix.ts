/**
 * Role matrix (agent 6, role-matrix).
 * ---------------------------------------------------------------------------
 * The "same action as N roles → N expected outcomes" test, run as data against
 * the live API. Each spec is `{ action, resource, expected: { role:
 * 'allow' | 'deny' } }` and is executed once per role with the matching
 * `x-actor-id`.
 *
 * The stale-role-cache bug shows up as a mismatch after a mid-matrix
 * demotion: one row demotes `usr_viktor` (admin → sales_rep) and re-checks.
 * With `BUG_STALE_ROLE_CACHE` on, `usr_viktor` still resolves to the cached
 * admin role, so the actual outcome diverges from the expected sales_rep
 * outcome → `passed: false`, `demoted: true`, and a blocker finding.
 *
 * The demotion is undone (promote) before returning so the matrix leaves the
 * database consistent.
 */
import type { PersonaId, Role } from '../../src/contracts/types.ts';
import { PERSONA_USER_IDS } from '../../src/contracts/app-api.ts';
import type { RoleMatrixRow } from './index.ts';
import { fetchJson } from './api-check.ts';

const ADMIN_ACTOR = PERSONA_USER_IDS.owner_emma;
const VIKTOR = PERSONA_USER_IDS.manager_viktor;

/** PersonaId per role — the seeded user acting as each role. */
const ROLE_TO_PERSONA: Record<Role, PersonaId> = {
  owner: 'owner_emma',
  admin: 'manager_viktor',
  sales_rep: 'rep_liam',
  support_agent: 'support_sofia',
  read_only: 'auditor_raul',
  external: 'contractor_dana',
};

const ALL_ROLES: Role[] = ['owner', 'admin', 'sales_rep', 'support_agent', 'read_only', 'external'];

/** Full 6-role expected outcomes per (action, resource), per BUILD-CONTRACT §3. */
const SPECS: Array<{
  action: string;
  resource: string;
  expected: Record<Role, 'allow' | 'deny'>;
}> = [
  {
    action: 'read',
    resource: 'contact',
    expected: {
      owner: 'allow',
      admin: 'allow',
      sales_rep: 'allow',
      support_agent: 'allow',
      read_only: 'allow',
      external: 'allow',
    },
  },
  {
    action: 'read',
    resource: 'deal',
    expected: {
      owner: 'allow',
      admin: 'allow',
      sales_rep: 'allow',
      support_agent: 'deny',
      read_only: 'allow',
      external: 'deny',
    },
  },
  {
    action: 'create',
    resource: 'contact',
    expected: {
      owner: 'allow',
      admin: 'allow',
      sales_rep: 'allow',
      support_agent: 'deny',
      read_only: 'deny',
      external: 'deny',
    },
  },
  {
    action: 'update',
    resource: 'deal',
    expected: {
      owner: 'allow',
      admin: 'allow',
      sales_rep: 'allow',
      support_agent: 'deny',
      read_only: 'deny',
      external: 'deny',
    },
  },
  {
    action: 'delete',
    resource: 'deal',
    expected: {
      owner: 'allow',
      admin: 'deny',
      sales_rep: 'deny',
      support_agent: 'deny',
      read_only: 'deny',
      external: 'deny',
    },
  },
  {
    action: 'send-email',
    resource: 'email',
    expected: {
      owner: 'allow',
      admin: 'allow',
      sales_rep: 'allow',
      support_agent: 'allow',
      read_only: 'deny',
      external: 'deny',
    },
  },
];

async function probe(
  baseUrl: string,
  actorId: string,
  action: string,
  resource: string,
): Promise<'allow' | 'deny'> {
  const res = await fetchJson(
    baseUrl,
    `/api/v1/permissions/check?action=${encodeURIComponent(action)}&resource=${encodeURIComponent(resource)}`,
    actorId,
  );
  // An API error (non-200) is treated as a deny: the actor could not perform
  // the action.
  if (res.status !== 200) return 'deny';
  const body = res.body as { allowed?: unknown } | null;
  const allowed = typeof body === 'object' && body !== null && body.allowed === true;
  return allowed ? 'allow' : 'deny';
}

function actorIdFor(role: Role): string {
  return PERSONA_USER_IDS[ROLE_TO_PERSONA[role]];
}

function checkAllRoles(
  baseUrl: string,
  action: string,
  resource: string,
): Promise<Record<Role, 'allow' | 'deny'>> {
  const actual: Record<Role, 'allow' | 'deny'> = {
    owner: 'deny',
    admin: 'deny',
    sales_rep: 'deny',
    support_agent: 'deny',
    read_only: 'deny',
    external: 'deny',
  };
  const promises: Promise<void>[] = [];
  for (const role of ALL_ROLES) {
    promises.push(
      (async () => {
        actual[role] = await probe(baseUrl, actorIdFor(role), action, resource);
      })(),
    );
  }
  return Promise.all(promises).then(() => actual);
}

/**
 * Run the role matrix against the live API, including one mid-matrix
 * demotion of `usr_viktor`. Returns one row per spec (plus the demoted row).
 */
export async function runRoleMatrix(
  baseUrl: string,
  _verifierActorId: string,
): Promise<RoleMatrixRow[]> {
  const rows: RoleMatrixRow[] = [];

  for (const spec of SPECS) {
    const actual = await checkAllRoles(baseUrl, spec.action, spec.resource);
    let passed = true;
    for (const role of ALL_ROLES) {
      if (actual[role] !== spec.expected[role]) passed = false;
    }
    rows.push({
      action: spec.action,
      resource: spec.resource,
      expected: spec.expected,
      actual,
      passed,
    });
  }

  // Mid-matrix demotion: usr_viktor admin → sales_rep, re-check `read invoice`.
  // Admin allows reading invoices; sales_rep denies them. With the stale-role
  // cache, `usr_viktor` still resolves as admin, so actual=allow but expected
  // = deny → the bug surfaces as a failed row.
  const DEMOTED_ACTION = 'read';
  const DEMOTED_RESOURCE = 'invoice';
  const DEMOTED_EXPECTED: Record<Role, 'allow' | 'deny'> = {
    owner: 'allow',
    admin: 'allow',
    sales_rep: 'deny',
    support_agent: 'deny',
    read_only: 'allow',
    external: 'deny',
  };
  await fetchJson(baseUrl, '/api/v1/admin/demote', ADMIN_ACTOR, 'POST', { userId: VIKTOR });
  try {
    const actual = await checkAllRoles(baseUrl, DEMOTED_ACTION, DEMOTED_RESOURCE);
    const demotedPassed = ALL_ROLES.every((role) => actual[role] === DEMOTED_EXPECTED[role]);
    rows.push({
      action: DEMOTED_ACTION,
      resource: DEMOTED_RESOURCE,
      expected: DEMOTED_EXPECTED,
      actual,
      passed: demotedPassed,
      demoted: true,
    });
  } finally {
    // Undo the demotion so the matrix leaves the DB consistent.
    await fetchJson(baseUrl, '/api/v1/admin/promote', ADMIN_ACTOR, 'POST', { userId: VIKTOR });
  }

  return rows;
}

export { SPECS };
