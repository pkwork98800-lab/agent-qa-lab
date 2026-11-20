/**
 * The `summarise` tool: answer composition over tool results only.
 * ---------------------------------------------------------------------------
 * Owned by agent 2b (apps/agent/**).
 *
 * `summarise` is one of the six frozen tools (`SummariseArgs = { instruction,
 * data }`), and the frozen endpoint catalogue defines no HTTP route for it.
 * That is not an oversight in this implementation: it is the agent's own
 * answer-composition step. The policy engine serialises the evidence it
 * collected (what each tool call actually returned) into `data`; `summarise`
 * turns that into a structured digest, and the answer templates render the
 * final answer from the digest and nothing else. No field is ever stated
 * unless it is present in a tool result.
 *
 * The execution is deterministic: same bundle in, same digest out.
 */
import type { ToolName } from '../../../src/contracts/types.ts';

/** One entry of the evidence bundle the policy hands to `summarise`. */
export interface EvidenceEntry {
  tool: ToolName;
  ok: boolean;
  args: Record<string, unknown>;
  payload: unknown;
}

export interface EvidenceBundle {
  entries: EvidenceEntry[];
}

export interface SummaryRecord {
  kind: string;
  id: string;
  fields: Record<string, unknown>;
}

export interface PermissionNote {
  action: string;
  resource: string;
  allowed: boolean;
  role: string;
  reason: string;
}

export interface SummaryResult {
  instruction: string;
  records: SummaryRecord[];
  permissions: PermissionNote[];
  failures: string[];
  text: string;
}

const ID_PREFIX_KIND: Record<string, string> = {
  con: 'contact',
  cmp: 'company',
  dls: 'deal',
  dli: 'line_item',
  inv: 'invoice',
  act: 'activity',
  eml: 'email',
  usr: 'user',
};

function kindOf(record: Record<string, unknown>): string {
  const id = typeof record.id === 'string' ? record.id : '';
  const prefix = id.split('_')[0] ?? '';
  return ID_PREFIX_KIND[prefix] ?? 'record';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordsFromPayload(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload)) return [];
  const items = payload.items;
  if (Array.isArray(items)) return items.filter(isRecord);
  if (typeof payload.id === 'string') return [payload];
  return [];
}

function permissionFrom(entry: EvidenceEntry): PermissionNote | null {
  if (entry.tool !== 'check_permissions' || !isRecord(entry.payload)) return null;
  const args = entry.args;
  return {
    action: typeof args.action === 'string' ? args.action : '',
    resource: typeof args.resource === 'string' ? args.resource : '',
    allowed: entry.payload.allowed === true,
    role: typeof entry.payload.role === 'string' ? entry.payload.role : '',
    reason: typeof entry.payload.reason === 'string' ? entry.payload.reason : '',
  };
}

function describe(record: SummaryRecord): string {
  const name = typeof record.fields.name === 'string' ? record.fields.name : undefined;
  const title = typeof record.fields.title === 'string' ? record.fields.title : undefined;
  const label = name ?? title ?? '';
  return label ? `${record.kind} ${record.id} (${label})` : `${record.kind} ${record.id}`;
}

/** Deterministic digest of the evidence bundle. */
export function summarise(instruction: string, data: string): SummaryResult {
  let bundle: EvidenceBundle = { entries: [] };
  try {
    const parsed: unknown = JSON.parse(data);
    if (isRecord(parsed) && Array.isArray(parsed.entries)) {
      bundle = { entries: parsed.entries as EvidenceEntry[] };
    }
  } catch {
    // A malformed bundle yields an empty digest rather than invented content.
    bundle = { entries: [] };
  }

  const records: SummaryRecord[] = [];
  const permissions: PermissionNote[] = [];
  const failures: string[] = [];

  for (const entry of bundle.entries) {
    const permission = permissionFrom(entry);
    if (permission) {
      permissions.push(permission);
      continue;
    }
    if (!entry.ok) {
      failures.push(`${entry.tool}: ${JSON.stringify(entry.args)}`);
      continue;
    }
    for (const record of recordsFromPayload(entry.payload)) {
      records.push({
        kind: kindOf(record),
        id: typeof record.id === 'string' ? record.id : '',
        fields: record,
      });
    }
  }

  const parts: string[] = [];
  if (records.length > 0) parts.push(records.map(describe).join('; '));
  for (const permission of permissions) {
    parts.push(
      `permission ${permission.action} on ${permission.resource}: ${permission.allowed ? 'allowed' : 'denied'}${permission.role ? ` (${permission.role})` : ''}`,
    );
  }
  if (failures.length > 0) parts.push(`failed calls: ${failures.join('; ')}`);
  const text = parts.length > 0 ? parts.join(' | ') : 'no tool results';

  return { instruction, records, permissions, failures, text };
}

/** Serialise the evidence bundle the way the `summarise` tool expects it. */
export function toSummariseData(bundle: EvidenceBundle): string {
  return JSON.stringify(bundle);
}
