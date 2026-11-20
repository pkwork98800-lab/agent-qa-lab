/**
 * Ground-truth verifier (agent 6).
 * ---------------------------------------------------------------------------
 * Answers: after the chat, is the app data actually correct — every field,
 * not just "a row was created"?
 *
 * Exports the frozen surface from docs/agent-briefs/agent-6-verify.md plus the
 * supporting result types. `verifyRun` diffs a `RunResult`'s before/after
 * snapshots, audits the diff, runs independent API checks and a role matrix,
 * and returns a `VerifyOutcome`. `generateDataIntegrityReport` renders many
 * outcomes to a single markdown report.
 *
 * Offline mode (diff + snapshot checks) works from the snapshots alone. Live
 * mode (API re-GET, permission probes, cross-scope 404, role matrix) requires
 * a booted app at `ctx.baseUrl`.
 */
import type { DbDiff, Role, RunResult } from '../../src/contracts/types.ts';
import { PERSONA_USER_IDS } from '../../src/contracts/app-api.ts';
import { diffSnapshots } from '../../src/lib/diff.ts';
import { auditDiff } from './diff-audit.ts';
import { runApiChecks } from './api-check.ts';
import { runRoleMatrix } from './role-matrix.ts';

export interface Finding {
  id: string;
  scenarioId: string;
  kind:
    | 'row-added'
    | 'row-removed'
    | 'row-changed'
    | 'consistency'
    | 'partial-write'
    | 'claims-vs-data'
    | 'api-check'
    | 'permission'
    | 'cross-scope';
  severity: 'blocker' | 'major' | 'minor';
  /** What the data should show. */
  expected: string;
  /** What the data actually shows. */
  actual: string;
  /** Pointer to the evidence (table.row.field, status code, curl command). */
  evidence: string;
}

export interface ApiCheckResult {
  method: string;
  path: string;
  actorId: string;
  status: number;
  ok: boolean;
  expectedStatus: number;
  body?: unknown;
  error?: string;
}

export interface RoleMatrixRow {
  action: string;
  resource: string;
  expected: Record<Role, 'allow' | 'deny'>;
  actual: Record<Role, 'allow' | 'deny'>;
  passed: boolean;
  demoted?: boolean;
}

export interface VerifyOutcome {
  scenarioId: string;
  status: 'pass' | 'fail';
  findings: Finding[];
  dbDiff: DbDiff;
  apiChecks: ApiCheckResult[];
  roleMatrix: RoleMatrixRow[];
}

function actorIdFor(run: RunResult): string {
  const id = PERSONA_USER_IDS[run.persona];
  if (!id) throw new Error(`no seeded user for persona ${run.persona}`);
  return id;
}

/**
 * Verify a single run against ground truth: the before/after DB snapshots plus
 * independent live API calls. `ctx.baseUrl` is required for the live checks;
 * the diff and snapshot audits run from snapshots alone.
 */
export async function verifyRun(
  run: RunResult,
  ctx: { baseUrl: string; actorId: string },
): Promise<VerifyOutcome> {
  const dbDiff = diffSnapshots(run.dbBefore, run.dbAfter);

  const diffFindings = auditDiff(run, dbDiff);

  const actorId = actorIdFor(run);
  const apiChecks = await runApiChecks(run, ctx.baseUrl, actorId, ctx.actorId);

  const roleMatrix = await runRoleMatrix(ctx.baseUrl, ctx.actorId);

  const findings = [
    ...diffFindings,
    ...apiCheckFindings(apiChecks),
    ...roleMatrixFindings(roleMatrix),
  ];
  const status =
    hasBlockerOrMajor(findings) || apiChecks.some((c) => !c.ok) || !roleMatrixPassed(roleMatrix)
      ? 'fail'
      : 'pass';

  return { scenarioId: run.scenarioId, status, findings, dbDiff, apiChecks, roleMatrix };
}

function apiCheckFindings(checks: ApiCheckResult[]): Finding[] {
  const findings: Finding[] = [];
  let seq = 0;
  for (const check of checks) {
    if (check.ok) continue;
    seq += 1;
    findings.push({
      id: `api-${String(seq)}`,
      scenarioId: '',
      kind: 'api-check',
      severity: 'blocker',
      expected: `HTTP ${String(check.expectedStatus)}`,
      actual: `HTTP ${String(check.status)}${check.error ? ` (${check.error})` : ''}`,
      evidence: `${check.method} ${check.path} as ${check.actorId}`,
    });
  }
  return findings;
}

function roleMatrixFindings(matrix: RoleMatrixRow[]): Finding[] {
  const findings: Finding[] = [];
  let seq = 0;
  for (const row of matrix) {
    if (row.passed) continue;
    seq += 1;
    const mismatches: string[] = [];
    for (const role of Object.keys(row.expected) as Role[]) {
      if (row.actual[role] !== row.expected[role]) {
        mismatches.push(`${role}: expected ${row.expected[role]}, actual ${row.actual[role]}`);
      }
    }
    findings.push({
      id: `role-${String(seq)}`,
      scenarioId: '',
      kind: 'permission',
      severity: row.demoted ? 'blocker' : 'major',
      expected: JSON.stringify(row.expected),
      actual: JSON.stringify(row.actual),
      evidence: `${row.action} ${row.resource}${row.demoted ? ' (usr_viktor demoted mid-matrix)' : ''} — ${mismatches.join('; ')}`,
    });
  }
  return findings;
}

function hasBlockerOrMajor(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === 'blocker' || f.severity === 'major');
}

function roleMatrixPassed(matrix: RoleMatrixRow[]): boolean {
  return matrix.every((row) => row.passed);
}

export { generateDataIntegrityReport } from './report.ts';
export type { DbDiff, Role, RunResult };
