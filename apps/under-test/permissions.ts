/**
 * Permission engine over the seeded `permissions` table.
 * ---------------------------------------------------------------------------
 * Owned by agent 2a (apps/under-test/**).
 *
 * `can()` answers one question: may this actor perform this action on this
 * resource (optionally narrowed to one row)? Scopes are evaluated as
 * BUILD-CONTRACT §3 defines them:
 *
 *   all     — no narrowing
 *   own     — the row's owner is the actor
 *   team    — the row's owner is on the actor's team, or is the actor
 *   company — the row's company is the actor's company
 *
 * When BUG_STALE_ROLE_CACHE is on, the role used here comes from the
 * module-level cache in `bugs.ts` rather than from the database, which is what
 * makes a mid-session demotion leak. Everything else in this module is honest.
 */
import type { Database } from 'better-sqlite3';
import type { Role } from '../../src/contracts/types.ts';
import type { PermissionRow } from '../../src/contracts/app-api.ts';
import { resolveRole } from './bugs.ts';
import { findRow, findUser, type Row } from './db.ts';

export type Action = 'read' | 'create' | 'update' | 'delete' | 'send-email';
export type Scope = PermissionRow['scope'];

export const ACTIONS: Action[] = ['read', 'create', 'update', 'delete', 'send-email'];

export interface Actor {
  id: string;
  role: Role;
  companyId: string | null;
  teamId: string | null;
}

export interface Decision {
  allowed: boolean;
  reason: string;
  /** The role the decision was made with — useful when the cache is stale. */
  role: Role;
  scope: Scope | null;
}

export interface CanInput {
  db: Database;
  role: Role;
  action: Action;
  resource: string;
  actor: Actor;
  /** The row being acted on, when there is one. */
  row?: Row | null;
}

function permissionRowFor(
  db: Database,
  role: Role,
  action: Action,
  resource: string,
): PermissionRow | null {
  const exact = db
    .prepare('SELECT * FROM permissions WHERE role = ? AND action = ? AND resource = ?')
    .get(role, action, resource) as PermissionRow | undefined;
  if (exact) return normalise(exact);
  const wildcard = db
    .prepare("SELECT * FROM permissions WHERE role = ? AND action = ? AND resource = '*'")
    .get(role, action) as PermissionRow | undefined;
  return wildcard ? normalise(wildcard) : null;
}

function normalise(row: PermissionRow): PermissionRow {
  return {
    role: row.role,
    action: row.action,
    resource: row.resource,
    allowed: row.allowed,
    scope: row.scope,
  };
}

/** Line items inherit the scope of their parent deal. */
function scopeRow(db: Database, resource: string, row: Row): Row {
  if (resource !== 'line_item') return row;
  const dealId = typeof row.dealId === 'string' ? row.dealId : null;
  if (!dealId) return row;
  const deal = findRow(db, 'deals', dealId);
  return deal ?? row;
}

function deny(role: Role, reason: string): Decision {
  return { allowed: false, reason, role, scope: null };
}

function ownerIdOf(row: Row): string | null {
  return typeof row.ownerId === 'string' ? row.ownerId : null;
}

function companyIdOf(resource: string, row: Row): string | null {
  if (resource === 'company') return typeof row.id === 'string' ? row.id : null;
  return typeof row.companyId === 'string' ? row.companyId : null;
}

/** The permission decision for one (role, action, resource[, row]) triple. */
export function can(input: CanInput): Decision {
  const { db, action, resource, actor, row } = input;
  const role = input.role;
  const permission = permissionRowFor(db, role, action, resource);

  if (!permission) {
    return deny(role, `role '${role}' has no '${action}' permission for '${resource}'`);
  }
  if (!permission.allowed) {
    return deny(role, `role '${role}' may not '${action}' '${resource}'`);
  }

  const target = row ? scopeRow(db, resource, row) : null;
  if (!target) {
    return {
      allowed: true,
      reason: `role '${role}' may '${action}' '${resource}' (scope '${permission.scope}')`,
      role,
      scope: permission.scope,
    };
  }

  switch (permission.scope) {
    case 'all':
      return {
        allowed: true,
        reason: `role '${role}' may '${action}' '${resource}'`,
        role,
        scope: 'all',
      };
    case 'own': {
      const ownerId = ownerIdOf(target);
      if (ownerId === null) {
        return deny(role, `'${resource}' carries no owner, so scope 'own' cannot be satisfied`);
      }
      if (ownerId !== actor.id) {
        return deny(
          role,
          `'${resource}' ${String(target.id)} is owned by ${ownerId}, not by the actor`,
        );
      }
      return {
        allowed: true,
        reason: `role '${role}' may '${action}' its own '${resource}'`,
        role,
        scope: 'own',
      };
    }
    case 'team': {
      const ownerId = ownerIdOf(target);
      if (ownerId === null) {
        return deny(role, `'${resource}' carries no owner, so scope 'team' cannot be satisfied`);
      }
      if (ownerId === actor.id) {
        return {
          allowed: true,
          reason: `role '${role}' may '${action}' a '${resource}' it owns`,
          role,
          scope: 'team',
        };
      }
      if (!actor.teamId) {
        return deny(
          role,
          `actor has no team, so '${resource}' ${String(target.id)} is out of scope`,
        );
      }
      const owner = findUser(db, ownerId);
      const ownerTeam = owner && typeof owner.teamId === 'string' ? owner.teamId : null;
      if (ownerTeam !== actor.teamId) {
        return deny(
          role,
          `'${resource}' ${String(target.id)} is owned by ${ownerId} (team ${ownerTeam ?? 'none'}), outside team ${actor.teamId}`,
        );
      }
      return {
        allowed: true,
        reason: `role '${role}' may '${action}' '${resource}' within team ${actor.teamId}`,
        role,
        scope: 'team',
      };
    }
    case 'company': {
      const companyId = companyIdOf(resource, target);
      if (!actor.companyId) {
        return deny(
          role,
          `actor has no company, so '${resource}' ${String(target.id)} is out of scope`,
        );
      }
      if (companyId !== actor.companyId) {
        return deny(
          role,
          `'${resource}' ${String(target.id)} belongs to company ${companyId ?? 'none'}, not ${actor.companyId}`,
        );
      }
      return {
        allowed: true,
        reason: `role '${role}' may '${action}' '${resource}' within company ${actor.companyId}`,
        role,
        scope: 'company',
      };
    }
    default:
      return deny(role, `unknown scope '${String(permission.scope)}'`);
  }
}

/** Build an actor from a users-table row. */
export function actorFromRow(row: Row): Actor {
  return {
    id: String(row.id),
    role: row.role as Role,
    companyId: typeof row.companyId === 'string' ? row.companyId : null,
    teamId: typeof row.teamId === 'string' ? row.teamId : null,
  };
}

/**
 * Resolve an actor from the database. The role comes back through the flag-gated
 * cache, which is the whole of BUG_STALE_ROLE_CACHE.
 */
export function resolveActor(db: Database, actorId: string): Actor | null {
  const row = findUser(db, actorId);
  if (!row) return null;
  const role = resolveRole(db, actorId, (id) => {
    const fresh = findUser(db, id);
    return (fresh?.role as Role | undefined) ?? 'read_only';
  });
  return {
    id: String(row.id),
    role,
    companyId: typeof row.companyId === 'string' ? row.companyId : null,
    teamId: typeof row.teamId === 'string' ? row.teamId : null,
  };
}
