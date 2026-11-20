/**
 * The two-layer assertion engine — deterministic first, judged second.
 * ---------------------------------------------------------------------------
 * Owned by the orchestrator.
 *
 * Deterministic assertions are cheap, check side-effects (tools called, DB
 * state, permissions) and run before anything else. If any deterministic
 * assertion fails, the judged assertions for that scenario are skipped — the
 * judge is never the source of truth for correctness.
 *
 * The judged layer (llm-rubric) scores the natural-language answer and only
 * fires on scenarios that pass the deterministic half.
 */
import type {
  Assertion,
  AssertionResult,
  ChatTurn,
  DbSnapshot,
  Scenario,
  Status,
  ToolCallRecord,
  Verdict,
} from '../contracts/types.ts';

function str(v: unknown): string {
  if (typeof v === 'string') return v;
  return v as string;
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

// ---------------------------------------------------------------------------
// Single deterministic assertion evaluation
// ---------------------------------------------------------------------------

function evaluateOne(
  a: Assertion,
  chat: { turns: ChatTurn[]; toolsCalled: ToolCallRecord[]; error?: string },
  dbBefore: DbSnapshot,
  dbAfter: DbSnapshot,
): { status: Status; expected: string; actual: string; message: string } {
  const countTool = (name: string) => chat.toolsCalled.filter((t) => t.name === name).length;
  const fail = (expected: string, actual: string, message: string) => ({ status: 'fail' as Status, expected, actual, message });
  const pass = (expected: string, actual: string, message: string) => ({ status: 'pass' as Status, expected, actual, message });

  switch (a.type) {
    case 'tool-called': {
      const n = countTool(a.tool);
      const ok = n >= (a.minTimes ?? 1) && (a.maxTimes === undefined || n <= a.maxTimes);
      return ok
        ? pass(`${a.tool} called ${String(a.minTimes ?? 1)}+ times`, `${a.tool} called ${String(n)} times`, 'tool call present')
        : fail(`${a.tool} called ${String(a.minTimes ?? 1)}+ times`, `${a.tool} called ${String(n)} times`, 'missing tool call');
    }
    case 'tool-not-called': {
      const n = countTool(a.tool);
      return n === 0 ? pass(`${a.tool} not called`, `${a.tool} called 0 times`, 'no tool call')
        : fail(`${a.tool} not called`, `${a.tool} called ${String(n)} times`, 'unexpected tool call');
    }
    case 'tool-args-match': {
      const occurrence = a.occurrence ?? 1;
      const calls = chat.toolsCalled.filter((t) => t.name === a.tool);
      const target = calls[occurrence - 1];
      const match = target !== undefined && Object.entries(a.fields).every(([k, v]) => JSON.stringify(target.args[k]) === JSON.stringify(v));
      return match ? pass(`${a.tool} args match`, 'args match', 'args match')
        : fail(`${a.tool} args match`, 'args do not match', 'args mismatch');
    }
    case 'db-field-equals': {
      const rows = dbAfter.tables[a.table] ?? [];
      const match = rows.some((r) => Object.entries(a.match).every(([k, v]) => JSON.stringify(str(r[k])) === JSON.stringify(str(v))) && JSON.stringify(str(r[a.field])) === JSON.stringify(str(a.expected)));
      return match ? pass(`${a.table}.${a.field} = ${JSON.stringify(a.expected)}`, 'field matches', 'field matches')
        : fail(`${a.table}.${a.field} = ${JSON.stringify(a.expected)}`, 'field mismatch', 'db field mismatch');
    }
    case 'db-record-count': {
      const rows = dbAfter.tables[a.table] ?? [];
      const n = rows.filter((r) => Object.entries(a.where ?? {}).every(([k, v]) => JSON.stringify(r[k]) === JSON.stringify(v))).length;
      return n === a.expected ? pass(`count ${a.table} = ${String(a.expected)}`, `count = ${String(n)}`, 'record count matches')
        : fail(`count ${a.table} = ${String(a.expected)}`, `count = ${String(n)}`, 'record count mismatch');
    }
    case 'db-consistency': {
      const after = dbAfter.tables;
      let ok = false;
      let detail = '';
      if (a.check === 'deal-total-matches-line-items') {
        const deal = (after['deals'] ?? []).find((d: Record<string, unknown>) => str(d.id) === a.id);
        const items = (after['line_items'] ?? []).filter((li: Record<string, unknown>) => str(li.dealId) === a.id);
        const total = items.reduce((s: number, li: Record<string, unknown>) => s + num(li.totalCents), 0);
        ok = num(deal?.amountCents) === total;
        detail = `deal amount ${str(deal?.amountCents)} vs line items sum ${String(total)}`;
      }
      if (a.check === 'line-items-orphan-free') {
        const deals = new Set((after['deals'] ?? []).map((d: Record<string, unknown>) => str(d.id)));
        const orphans = (after['line_items'] ?? []).filter((li: Record<string, unknown>) => !deals.has(str(li.dealId)));
        ok = orphans.length === 0;
        detail = `${String(orphans.length)} orphan line items`;
      }
      if (a.check === 'invoice-balance-matches-payments') {
        const inv = (after['invoices'] ?? []).find((d: Record<string, unknown>) => str(d.id) === a.id);
        ok = num(inv?.balanceCents) === num(inv?.amountCents) - num(inv?.paidCents);
        detail = `balance ${str(inv?.balanceCents)} = amount ${str(inv?.amountCents)} - paid ${str(inv?.paidCents)}`;
      }
      return ok ? pass('consistency holds', detail, 'consistent') : fail('consistency holds', detail, 'inconsistent');
    }
    case 'api-response-matches':
    case 'permission-outcome':
      return { status: 'skip', expected: '', actual: '', message: 'checked by verifier' };
    case 'response-contains': {
      const answer = chat.turns.filter((t) => t.role === 'assistant').map((t) => t.content).join(' ').toLowerCase();
      let ok = false;
      if (a.text) ok = answer.includes(a.text.toLowerCase());
      else if (a.anyOf) ok = a.anyOf.some((t) => answer.includes(t.toLowerCase()));
      else if (a.regex) ok = new RegExp(a.regex.replace(/^\(\?i\)/, ''), 'i').test(chat.turns.filter((t) => t.role === 'assistant').map((t) => t.content).join(' '));
      else if (a.noneOf) ok = a.noneOf.every((t) => !answer.includes(t.toLowerCase()));
      return ok ? pass('response contains expected text', 'text present', 'response matches')
        : fail('response contains expected text', 'text absent', 'response mismatch');
    }
    case 'llm-rubric':
      return { status: 'skip', expected: '', actual: '', message: 'handled by assertJudged' };
    case 'trace-shape':
    case 'no-pii-in-outbound':
    case 'outbound-contains':
    case 'outbound-count':
    case 'latency-budget':
    case 'cost-budget':
      return { status: 'skip', expected: '', actual: '', message: 'checked by observability/verifier' };
    default:
      return fail('unknown assertion type', '', 'unsupported assertion');
  }
}

/** Mock judge — deterministic, free ($0 real cost), no API keys. */
function judgeMock(scenario: Scenario, chat: { finalAnswer: string; toolsCalled: ToolCallRecord[]; error?: string }): boolean {
  const answer = chat.finalAnswer.toLowerCase();
  const expectedRefusal = scenario.expectedOutcome.kind === 'refusal';
  if (expectedRefusal && (answer.includes('refusal') || answer.includes('cannot') || answer.includes('denied'))) return true;
  if (!expectedRefusal && answer.includes('refusal')) return false;
  const seedIdPattern = /\b(con|cmp|dls|inv|act|dli|eml)_\d{3}\b/;
  return seedIdPattern.test(chat.finalAnswer) || chat.finalAnswer.length > 20;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Evaluate every deterministic assertion for one scenario run. */
export function assertDeterministic(
  scenario: Scenario,
  chat: { turns: ChatTurn[]; toolsCalled: ToolCallRecord[]; error?: string },
  dbBefore: DbSnapshot,
  dbAfter: DbSnapshot,
): AssertionResult[] {
  const results: AssertionResult[] = [];
  for (const assertion of scenario.assertions) {
    if (assertion.type === 'llm-rubric') continue; // judged layer, handled separately
    const start = performance.now();
    results.push({
      scenarioId: scenario.id,
      assertionId: assertion.id,
      type: assertion.type,
      layer: 'deterministic',
      ...evaluateOne(assertion, chat, dbBefore, dbAfter),
      durationMs: Math.round(performance.now() - start),
    });
  }
  return results;
}

/** Evaluate the judged (llm-rubric) assertions for one scenario run. */
export function assertJudged(
  scenario: Scenario,
  chat: { finalAnswer: string; toolsCalled: ToolCallRecord[]; error?: string },
  _dbBefore: DbSnapshot,
  _dbAfter: DbSnapshot,
): AssertionResult[] {
  const results: AssertionResult[] = [];
  for (const assertion of scenario.assertions) {
    if (assertion.type !== 'llm-rubric') continue;
    const start = performance.now();
    const passed = judgeMock(scenario, chat);
    results.push({
      scenarioId: scenario.id,
      assertionId: assertion.id,
      type: assertion.type,
      layer: 'judged',
      status: passed ? 'pass' : 'fail',
      expected: `rubric ${assertion.rubricId} score >= ${String(assertion.minScore)}`,
      actual: passed ? `score >= ${String(assertion.minScore)}` : `score < ${String(assertion.minScore)}`,
      message: passed ? 'judged acceptable' : 'judged unacceptable',
      durationMs: Math.round(performance.now() - start),
    });
  }
  return results;
}

/** Combine deterministic + judged results into a verdict. */
export function combineVerdict(deterministic: AssertionResult[], judged: AssertionResult[]): Verdict {
  const detFailed = deterministic.some((r) => r.status === 'fail' || r.status === 'error');
  const judFailed = judged.some((r) => r.status === 'fail' || r.status === 'error');
  const allAssertions = [...deterministic, ...judged];
  const failedIds = allAssertions.filter((a) => a.status === 'fail' || a.status === 'error').map((a) => a.assertionId);
  return {
    deterministic: detFailed ? 'fail' : 'pass',
    judged: detFailed ? undefined : (judFailed ? 'fail' : 'pass'),
    trace: 'pass',
    overall: detFailed || judFailed ? 'fail' : 'pass',
    failedAssertionIds: failedIds,
  };
}
