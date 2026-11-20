/**
 * Diff audit (agent 6, diff-audit).
 * ---------------------------------------------------------------------------
 * Turns `diffSnapshots(dbBefore, dbAfter)` into findings, then runs the
 * cross-field consistency checks over `db_after`, detects silent partial
 * writes, and compares agent claims against the stored data.
 *
 * Row-level findings (added / removed / changed) are reported with
 * field-level detail. Cross-field checks (deal totals, orphan line items,
 * invoice balances) run over *all* rows in `db_after`, not just the scenario's
 * rows, and a mismatch is a `blocker`.
 */
import type { DbDiff, RunResult } from '../../src/contracts/types.ts';
import type { Finding } from './index.ts';

export interface AuditedDiff {
  findings: Finding[];
}

/** Severity for an unexpected row change during a read-only scenario. */
function changeSeverity(run: RunResult): 'blocker' | 'major' | 'minor' {
  const writeTools = run.toolsCalled.filter(
    (t) => t.name === 'create_record' || t.name === 'update_record',
  );
  return writeTools.length === 0 ? 'major' : 'minor';
}

/**
 * Build row-level findings from the diff, plus cross-field consistency checks,
 * silent-partial-write detection, and agent-claims vs data consistency.
 */
export function auditDiff(run: RunResult, dbDiff: DbDiff): Finding[] {
  const findings: Finding[] = [];
  let seq = 0;

  const nextId = (): string => {
    seq += 1;
    return String(seq);
  };

  // ---- row-level: added / removed / changed --------------------------------
  for (const [table, delta] of Object.entries(dbDiff.tables)) {
    for (const row of delta.added) {
      findings.push({
        id: `diff-${nextId()}`,
        scenarioId: run.scenarioId,
        kind: 'row-added',
        severity: changeSeverity(run),
        expected: 'no new row',
        actual: `row added: ${JSON.stringify(row)}`,
        evidence: `${table}.${(row as { id?: string }).id ?? '<no-id>'}`,
      });
    }
    for (const row of delta.removed) {
      findings.push({
        id: `diff-${nextId()}`,
        scenarioId: run.scenarioId,
        kind: 'row-removed',
        severity: changeSeverity(run),
        expected: 'row still present',
        actual: `row removed: ${JSON.stringify(row)}`,
        evidence: `${table}.${(row as { id?: string }).id ?? '<no-id>'}`,
      });
    }
    for (const change of delta.changed) {
      findings.push({
        id: `diff-${nextId()}`,
        scenarioId: run.scenarioId,
        kind: 'row-changed',
        severity: changeSeverity(run),
        expected: JSON.stringify(change.before),
        actual: JSON.stringify(change.after),
        evidence: `${table}.${change.id}.${change.field}`,
      });
    }
  }

  // ---- cross-field consistency checks over db_after ------------------------
  const after = run.dbAfter.tables;
  const deals = after['deals'] ?? [];
  const lineItems = after['line_items'] ?? [];
  const invoices = after['invoices'] ?? [];

  const dealIds = new Set(deals.map((d) => String(d.id)));

  // deal-total-matches-line-items: every deal
  for (const deal of deals) {
    const dealId = String(deal.id);
    const expected = Number(deal.amountCents ?? 0);
    const actual = lineItems
      .filter((li) => String(li.dealId) === dealId)
      .reduce((sum, li) => sum + Number(li.totalCents ?? 0), 0);
    if (expected !== actual) {
      findings.push({
        id: `diff-${nextId()}`,
        scenarioId: run.scenarioId,
        kind: 'consistency',
        severity: 'blocker',
        expected: `deal ${dealId} amountCents=${String(expected)}`,
        actual: `SUM(line_items.totalCents)=${String(actual)}`,
        evidence: `deals.${dealId}.amountCents: deal-total-matches-line-items mismatch (amountCents=${String(expected)} but SUM(totalCents)=${String(actual)})`,
      });
    }
  }

  // line-items-orphan-free: every line item references an existing deal
  for (const li of lineItems) {
    const dealId = (li.dealId as string | undefined) ?? '';
    if (!dealIds.has(dealId)) {
      findings.push({
        id: `diff-${nextId()}`,
        scenarioId: run.scenarioId,
        kind: 'consistency',
        severity: 'blocker',
        expected: `line item ${(li as { id?: string }).id ?? '<no-id>'} references an existing deal`,
        actual: `references deal ${dealId} which does not exist`,
        evidence: `line_items.${(li as { id?: string }).id ?? '<no-id>'}.dealId: line-items-orphan-free violation`,
      });
    }
  }

  // invoice-balance-matches-payments
  for (const inv of invoices) {
    const invId = String(inv.id);
    const amount = Number(inv.amountCents ?? 0);
    const paid = Number(inv.paidCents ?? 0);
    const balance = Number(inv.balanceCents ?? 0);
    const expected = amount - paid;
    if (balance !== expected) {
      findings.push({
        id: `diff-${nextId()}`,
        scenarioId: run.scenarioId,
        kind: 'consistency',
        severity: 'blocker',
        expected: `invoice ${invId} balanceCents=${String(expected)}`,
        actual: `balanceCents=${String(balance)}`,
        evidence: `invoices.${invId}.balanceCents: invoice-balance-matches-payments mismatch (balance=${String(balance)} but amount-paid=${String(expected)})`,
      });
    }
  }

  // ---- silent partial write detection --------------------------------------
  const beforeDeals = run.dbBefore.tables['deals'] ?? [];
  const beforeDealById = new Map(beforeDeals.map((d) => [String(d.id), d]));
  const addedLineItemsByDeal: Record<string, number> = {};
  for (const li of (dbDiff.tables['line_items'] ?? { added: [] }).added) {
    const dealId = (li.dealId as string | undefined) ?? '';
    addedLineItemsByDeal[dealId] = (addedLineItemsByDeal[dealId] ?? 0) + Number(li.totalCents ?? 0);
  }
  for (const deal of deals) {
    const dealId = String(deal.id);
    const before = beforeDealById.get(dealId);
    if (!before) continue;
    const beforeAmount = Number(before.amountCents ?? 0);
    const afterAmount = Number(deal.amountCents ?? 0);
    const delta = afterAmount - beforeAmount;
    if (delta === 0) continue;
    const addedSum = addedLineItemsByDeal[dealId] ?? 0;
    if (delta !== addedSum) {
      findings.push({
        id: `diff-${nextId()}`,
        scenarioId: run.scenarioId,
        kind: 'partial-write',
        severity: 'blocker',
        expected: `deal ${dealId} amountCents changed by exactly the added line-item total (${String(addedSum)})`,
        actual: `amountCents ${String(beforeAmount)} → ${String(afterAmount)} (delta ${String(delta)}) but only ${String(addedSum)} of line-item totalCents added`,
        evidence: `deals.${dealId}.amountCents: partial write — total recomputed by ${String(delta)} while only ${String(addedSum)} persisted`,
      });
    }
  }

  // ---- agent claims vs data consistency ------------------------------------
  for (const call of run.toolsCalled) {
    if (call.name !== 'update_record' || !call.ok) continue;
    const type = String(call.args.type);
    const id = String(call.args.id);
    const fields = call.args.fields as Record<string, unknown> | undefined;
    if (!fields || typeof fields !== 'object') continue;
    const table = tableOf(type);
    const row = (run.dbAfter.tables[table] ?? []).find((r) => String(r.id) === id);
    if (!row) continue;
    for (const [field, claimed] of Object.entries(fields)) {
      const actual = row[field];
      if (JSON.stringify(claimed) !== JSON.stringify(actual)) {
        findings.push({
          id: `diff-${nextId()}`,
          scenarioId: run.scenarioId,
          kind: 'claims-vs-data',
          severity: 'blocker',
          expected: `agent set ${type} ${id}.${field} = ${JSON.stringify(claimed)}`,
          actual: `DB stores ${type} ${id}.${field} = ${JSON.stringify(actual)}`,
          evidence: `agent answer claims "${String(claimed)}" but ${table}.${id}.${field} is ${JSON.stringify(actual)}`,
        });
      }
    }
  }

  return findings;
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
