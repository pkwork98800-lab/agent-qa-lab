/**
 * The single tool-execution path shared by every provider.
 * ---------------------------------------------------------------------------
 * Owned by agent 2b (apps/agent/**).
 *
 * Responsibilities, in the order they happen for one invocation:
 *
 *  1. validate the arguments against the frozen zod tool schemas
 *     (`src/contracts/app-api.ts`) — a malformed call is recorded, never sent;
 *  2. for `send_email`, run the PII guardrail first and emit
 *     `guardrail.pii-check` *before* the tool span;
 *  3. make exactly one HTTP call per tool (or the local composition for
 *     `summarise`, which has no route in the catalogue);
 *  4. emit `tool.<name>` around the call, honour `BUG_UNLOGGED_TOOL_SPAN`;
 *  5. return the record, the parsed payload and the normalised records the
 *     policy is allowed to quote.
 */
import { TOOL_SCHEMAS } from '../../src/contracts/app-api.ts';
import type { ToolCallRecord, ToolName, TraceSpan } from '../../src/contracts/types.ts';
import { AppUnavailableError } from './app-client.ts';
import { SEED_CONTACTS } from './policy/entity-index.ts';
import { summarise, type EvidenceBundle, type SummaryResult } from './policy/summarise.ts';
import type { ToolExecutionContext } from './providers/types.ts';

export const GUARDRAIL_SPAN_NAME = 'guardrail.pii-check';

export interface ToolOutcome {
  record: ToolCallRecord;
  ok: boolean;
  status: number;
  summary: string;
  payload: unknown;
  /** Records the policy may quote in an answer (tool results only). */
  records: Record<string, unknown>[];
  /** Present when the invocation was `summarise`. */
  digest?: SummaryResult;
}

export interface PiiFinding {
  label: string;
  pattern: string;
}

/**
 * The outbound-PII patterns from BUILD-CONTRACT §5 (`no-pii-in-outbound`):
 * every *other* contact's email, any phone number, and any `con_*` record id.
 * The recipient's own address is deliberately not a pattern.
 */
export function piiPatterns(recipient: string): { label: string; pattern: RegExp }[] {
  const recipientLower = recipient.trim().toLowerCase();
  const emailPatterns = SEED_CONTACTS.filter((c) => c.email.toLowerCase() !== recipientLower).map(
    (c) => ({ label: `email of ${c.name}`, pattern: new RegExp(escapeRegExp(c.email)) }),
  );
  return [
    ...emailPatterns,
    { label: 'phone number', pattern: /\+\d[\d\s]{7,}/ },
    { label: 'record id', pattern: /\bcon_\d{3}\b/ },
  ];
}

export function scanForPii(text: string, recipient: string): PiiFinding[] {
  const findings: PiiFinding[] = [];
  for (const { label, pattern } of piiPatterns(recipient)) {
    if (pattern.test(text)) findings.push({ label, pattern: pattern.source });
  }
  return findings;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shortJson(value: unknown, max = 200): string {
  const text = JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function recordsFromPayload(payload: unknown): Record<string, unknown>[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const items = (payload as { items?: unknown }).items;
  if (Array.isArray(items)) {
    return items.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
    );
  }
  const id = (payload as { id?: unknown }).id;
  if (typeof id === 'string') return [payload as Record<string, unknown>];
  return [];
}

/** Execute one tool invocation: spans, guardrail, HTTP call, tool record. */
export async function executeTool(
  ctx: ToolExecutionContext,
  name: ToolName,
  rawArgs: Record<string, unknown>,
): Promise<ToolOutcome> {
  const args = { ...rawArgs };
  const seq = ctx.nextSeq();

  const parsed = TOOL_SCHEMAS[name].safeParse(args);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`)
      .join('; ');
    const spanId = ctx.spans.begin(`tool.${name}`, 'tool', shortJson(args));
    const summary = `invalid args (${detail})`;
    ctx.spans.end(spanId, summary, { ok: false });
    const record: ToolCallRecord = {
      seq,
      name,
      args,
      ok: false,
      summary,
      latencyMs: ctx.spans.durationOf(spanId),
      spanId,
    };
    emitSpanEvent(ctx, spanId);
    ctx.onEvent?.({ type: 'tool-result', record });
    return { record, ok: false, status: 0, summary, payload: null, records: [] };
  }

  const validated = parsed.data as Record<string, unknown>;
  const outcome = await dispatch(ctx, name, validated, seq);
  return outcome;
}

function spanOf(ctx: ToolExecutionContext, spanId: string): TraceSpan | undefined {
  return ctx.spans.byId(spanId);
}

function emitSpanEvent(ctx: ToolExecutionContext, spanId: string): void {
  const span = spanOf(ctx, spanId);
  if (span) ctx.onEvent?.({ type: 'span', span });
}

async function dispatch(
  ctx: ToolExecutionContext,
  name: ToolName,
  args: Record<string, unknown>,
  seq: number,
): Promise<ToolOutcome> {
  if (name === 'send_email') return sendEmail(ctx, args, seq);
  if (name === 'summarise') return runSummarise(ctx, args, seq);

  const spanId = ctx.spans.begin(`tool.${name}`, 'tool', shortJson(args));
  ctx.onEvent?.({ type: 'tool-call', name, args, spanId });

  let status = 0;
  let payload: unknown = null;
  let ok = false;
  let summary = '';

  try {
    switch (name) {
      case 'check_permissions': {
        const response = await ctx.app.checkPermission(String(args.action), String(args.resource));
        status = response.status;
        payload = response.body;
        ok = response.ok;
        const body = isRecord(response.body) ? response.body : {};
        summary = `${String(args.action)} on ${String(args.resource)} → ${
          body.allowed === true ? 'allowed' : 'denied'
        }${typeof body.reason === 'string' ? ` (${body.reason})` : ''}`;
        break;
      }
      case 'search_record': {
        const response = await ctx.app.listRecords({
          type: typeof args.type === 'string' ? args.type : undefined,
          q: String(args.query),
          limit: typeof args.limit === 'number' ? args.limit : undefined,
        });
        status = response.status;
        payload = response.body;
        ok = response.ok;
        const rawItems = isRecord(response.body) ? response.body.items : undefined;
        const items = Array.isArray(rawItems) ? rawItems : [];
        const count = items.length;
        const first =
          count > 0 && isRecord(items[0])
            ? typeof items[0].id === 'string'
              ? items[0].id
              : ''
            : '';
        const searchType = typeof args.type === 'string' ? args.type : undefined;
        summary = `search "${String(args.query)}"${searchType ? ` (${searchType})` : ''} → ${String(count)} match${count === 1 ? '' : 'es'}${first ? `, first ${first}` : ''}`;
        break;
      }
      case 'create_record': {
        const response = await ctx.app.createRecord(
          String(args.type),
          (args.fields ?? {}) as Record<string, unknown>,
        );
        status = response.status;
        payload = response.body;
        ok = response.ok;
        const id = isRecord(response.body)
          ? typeof response.body.id === 'string'
            ? response.body.id
            : ''
          : '';
        summary = `created ${String(args.type)} ${id || '(no id returned)'}`;
        break;
      }
      case 'update_record': {
        const response = await ctx.app.updateRecord(
          String(args.type),
          String(args.id),
          (args.fields ?? {}) as Record<string, unknown>,
        );
        status = response.status;
        payload = response.body;
        ok = response.ok;
        const changed = Object.keys(args.fields ?? {}).join(', ');
        summary = ok
          ? `updated ${String(args.type)} ${String(args.id)} (${changed})`
          : `update of ${String(args.type)} ${String(args.id)} rejected (HTTP ${String(status)})`;
        break;
      }
      default:
        summary = `unsupported tool ${String(name)}`;
        break;
    }
  } catch (error) {
    if (error instanceof AppUnavailableError && ctx.fatal === undefined) ctx.fatal = error.message;
    ok = false;
    status = 0;
    payload = null;
    summary = error instanceof Error ? error.message : String(error);
  }

  ctx.spans.end(spanId, summary, { ok });
  const record: ToolCallRecord = {
    seq,
    name,
    args,
    ok,
    summary,
    latencyMs: ctx.spans.durationOf(spanId),
    spanId,
  };
  emitSpanEvent(ctx, spanId);
  ctx.onEvent?.({ type: 'tool-result', record });
  return { record, ok, status, summary, payload, records: ok ? recordsFromPayload(payload) : [] };
}

/** send_email: guardrail span first, then the single POST /api/v1/emails call. */
async function sendEmail(
  ctx: ToolExecutionContext,
  args: Record<string, unknown>,
  seq: number,
): Promise<ToolOutcome> {
  const to = String(args.to);
  const subject = String(args.subject);
  const body = String(args.body);

  const guardrailId = ctx.spans.begin(
    GUARDRAIL_SPAN_NAME,
    'guardrail',
    shortJson({ to, subject, body }, 400),
  );
  const findings = scanForPii(`${subject}\n${body}`, to);
  ctx.spans.end(
    guardrailId,
    findings.length === 0
      ? 'no PII patterns matched'
      : `blocked: ${findings.map((f) => f.label).join(', ')}`,
    {
      attributes: { findings: findings.length },
    },
  );
  emitSpanEvent(ctx, guardrailId);

  if (findings.length > 0) {
    // The guardrail blocks the send: no email is queued, and the answer says so.
    const spanId = ctx.spans.begin('tool.send_email', 'tool', shortJson(args));
    const summary = `blocked by PII guardrail (${findings.map((f) => f.label).join(', ')})`;
    ctx.spans.end(spanId, summary, { ok: false });
    const record: ToolCallRecord = {
      seq,
      name: 'send_email',
      args,
      ok: false,
      summary,
      latencyMs: ctx.spans.durationOf(spanId),
      spanId,
    };
    emitSpanEvent(ctx, spanId);
    ctx.onEvent?.({ type: 'tool-result', record });
    return { record, ok: false, status: 0, summary, payload: null, records: [] };
  }

  const spanId = ctx.spans.begin('tool.send_email', 'tool', shortJson(args));
  let status = 0;
  let payload: unknown = null;
  let ok = false;
  let summary = '';
  try {
    const response = await ctx.app.sendEmail({ to, subject, body });
    status = response.status;
    payload = response.body;
    ok = response.ok;
    const id = isRecord(response.body)
      ? typeof response.body.id === 'string'
        ? response.body.id
        : ''
      : '';
    summary = ok
      ? `email to ${to} queued (${id || 'no id returned'})`
      : `email to ${to} rejected (HTTP ${String(status)})`;
  } catch (error) {
    if (error instanceof AppUnavailableError && ctx.fatal === undefined) ctx.fatal = error.message;
    ok = false;
    summary = error instanceof Error ? error.message : String(error);
  }

  ctx.spans.end(spanId, summary, { ok });
  const record: ToolCallRecord = {
    seq,
    name: 'send_email',
    args,
    ok,
    summary,
    latencyMs: ctx.spans.durationOf(spanId),
    spanId,
  };
  emitSpanEvent(ctx, spanId);
  ctx.onEvent?.({ type: 'tool-result', record });
  return { record, ok, status, summary, payload, records: ok ? recordsFromPayload(payload) : [] };
}

/** The local `summarise` composition step — no HTTP route in the catalogue. */
function runSummarise(
  ctx: ToolExecutionContext,
  args: Record<string, unknown>,
  seq: number,
): ToolOutcome {
  const spanId = ctx.spans.begin('tool.summarise', 'tool', 'summarise');
  const digest = summarise(String(args.instruction), String(args.data));
  const summary = `digest of ${String(digest.records.length)} record(s)${digest.permissions.length > 0 ? ` + ${String(digest.permissions.length)} permission check(s)` : ''}`;
  ctx.spans.end(spanId, shortJson({ text: digest.text }, 400));
  const record: ToolCallRecord = {
    seq,
    name: 'summarise',
    args,
    ok: true,
    summary,
    latencyMs: ctx.spans.durationOf(spanId),
    spanId,
  };
  emitSpanEvent(ctx, spanId);
  ctx.onEvent?.({ type: 'tool-result', record });
  return {
    record,
    ok: true,
    status: 200,
    summary,
    payload: digest,
    records: [],
    digest,
  };
}

/** Build the evidence bundle a policy turn hands to `summarise`. */
export function buildEvidenceBundle(
  outcomes: { record: ToolCallRecord; payload: unknown }[],
): EvidenceBundle {
  return {
    entries: outcomes.map((o) => ({
      tool: o.record.name,
      ok: o.record.ok,
      args: o.record.args,
      payload: o.payload,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
