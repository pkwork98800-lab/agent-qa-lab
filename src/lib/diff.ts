import type { DbDiff, DbSnapshot } from '../contracts/types.ts';
import { stableStringify } from './hashing.ts';

type FieldChange = DbDiff['tables'][string]['changed'][number];

/**
 * Field-level before/after diff of two DB snapshots — the core artefact of the
 * ground-truth verifier.
 *
 * Rows are keyed by their `id` field; rows without an `id` are fingerprinted by
 * their JSON text, which is how such rows are matched across snapshots. Per
 * table only the fields that actually differ are reported, deep-compared
 * through `stableStringify` so a re-serialised object does not read as changed.
 * Tables are visited alphabetically and entries ordered by row id, so the same
 * pair of snapshots always produces the same bytes.
 */
export function diffSnapshots(before: DbSnapshot, after: DbSnapshot): DbDiff {
  const tables: DbDiff['tables'] = {};
  const tableNames = [
    ...new Set([...Object.keys(before.tables), ...Object.keys(after.tables)]),
  ].sort();

  for (const table of tableNames) {
    const beforeRows = indexRows(before.tables[table] ?? []);
    const afterRows = indexRows(after.tables[table] ?? []);
    const added: Record<string, unknown>[] = [];
    const removed: Record<string, unknown>[] = [];
    const changed: FieldChange[] = [];

    for (const [key, row] of afterRows) {
      if (!beforeRows.has(key)) added.push(row);
    }
    for (const [key, row] of beforeRows) {
      if (!afterRows.has(key)) removed.push(row);
    }
    for (const [key, beforeRow] of beforeRows) {
      const afterRow = afterRows.get(key);
      if (afterRow === undefined) continue;
      changed.push(...fieldChanges(beforeRow, afterRow, key));
    }

    tables[table] = {
      added: added.sort((left, right) => compareKeys(rowKey(left), rowKey(right))),
      removed: removed.sort((left, right) => compareKeys(rowKey(left), rowKey(right))),
      changed: changed.sort((left, right) =>
        compareKeys(`${left.id}\u0000${left.field}`, `${right.id}\u0000${right.field}`),
      ),
    };
  }

  return { tables };
}

function indexRows(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const index = new Map<string, Record<string, unknown>>();
  const keyed = rows.map((row) => ({ key: rowKey(row), row }));
  keyed.sort((left, right) => compareKeys(left.key, right.key));
  for (const entry of keyed) index.set(entry.key, entry.row);
  return index;
}

function rowKey(row: Record<string, unknown>): string {
  const id = row['id'];
  return typeof id === 'string' || typeof id === 'number' ? String(id) : JSON.stringify(row);
}

function fieldChanges(
  beforeRow: Record<string, unknown>,
  afterRow: Record<string, unknown>,
  id: string,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const fields = [...new Set([...Object.keys(beforeRow), ...Object.keys(afterRow)])];
  for (const field of fields) {
    const beforeValue = beforeRow[field];
    const afterValue = afterRow[field];
    if (stableStringify(beforeValue) !== stableStringify(afterValue)) {
      changes.push({ id, field, before: beforeValue, after: afterValue });
    }
  }
  return changes;
}

/** Code-unit comparison: identical ordering on every machine, every locale. */
function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
