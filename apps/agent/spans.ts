/**
 * Span emission for the agent under test.
 * ---------------------------------------------------------------------------
 * Owned by agent 2b (apps/agent/**).
 *
 * Implements BUILD-CONTRACT §6 and the agent brief:
 *
 *  - one root `agent.run` span (kind `agent`), parent id `null`;
 *  - one `tool.<tool_name>` span per invocation (kind `tool`);
 *  - one `llm.generate` span for the final answer (kind `llm`, `model` set,
 *    `promptVersion` = `v1`, `usage` populated);
 *  - one `guardrail.pii-check` span before every `tool.send_email`
 *    (kind `guardrail`);
 *  - span ids `spn-<n>` (a monotonic counter, stable for a run), trace id
 *    `trc-<scenarioId>`;
 *  - span timings come from a monotonic counter starting at 0 — no wall clock
 *    anywhere in the agent, so a run replays byte-identically.
 *
 * Spans are opened with `begin(...)` and closed with `end(...)` so the
 * duration on a tool span really is the window around the HTTP call. The
 * counter only advances when a span closes, which keeps durations monotonic
 * and overlap-free without reading a clock.
 *
 * The latent telemetry bug `BUG_UNLOGGED_TOOL_SPAN` (ON by default) is
 * implemented here rather than in the app: when the flag is on, `send_email`
 * runs normally — the email really goes out — but neither its tool span nor
 * the preceding guardrail span is emitted. The span id is still consumed, so
 * the emitted id sequence has a gap and the `ToolCallRecord.spanId` points at
 * a span that does not exist. That is deliberate: the observability module
 * polices the trace and must be able to see the missing step from either
 * direction (a dangling reference, and a missing span name).
 */
import type { PersonaId, TraceSpan } from '../../src/contracts/types.ts';

export const BUG_UNLOGGED_TOOL_SPAN = 'BUG_UNLOGGED_TOOL_SPAN';

export interface SpanUsage {
  promptTokens: number;
  completionTokens: number;
}

type SpanKind = TraceSpan['kind'];

interface PendingSpan {
  id: string;
  name: string;
  kind: SpanKind;
  startMs: number;
  input?: string;
  model?: string;
  promptVersion?: string;
  attributes?: Record<string, string | number | boolean>;
}

export class SpanWriter {
  readonly traceId: string;
  private readonly spanList: TraceSpan[] = [];
  private readonly pending = new Map<string, PendingSpan>();
  private readonly rootId: string;
  private readonly rootPending: PendingSpan;
  private readonly bugFlags: Record<string, boolean>;

  /** Monotonic tick counter — the run's notion of time. Starts at 0. */
  private ticks = 0;
  /** Monotonic span-id counter. Advances even for suppressed spans. */
  private spanCount = 0;
  private closed = false;

  constructor(
    private readonly scenarioId: string,
    private readonly persona: PersonaId,
    bugFlags: Record<string, boolean>,
  ) {
    this.traceId = `trc-${scenarioId}`;
    this.bugFlags = bugFlags;
    this.spanCount += 1;
    this.rootId = `spn-${String(this.spanCount)}`;
    this.rootPending = {
      id: this.rootId,
      name: 'agent.run',
      kind: 'agent',
      startMs: 0,
      input: `persona=${persona}`,
    };
    this.pending.set(this.rootId, this.rootPending);
  }

  get rootSpanId(): string {
    return this.rootId;
  }

  /** All spans emitted so far, in emission order (the root span closes last). */
  spans(): TraceSpan[] {
    return this.spanList;
  }

  private allocateId(): string {
    this.spanCount += 1;
    return `spn-${String(this.spanCount)}`;
  }

  /** Open a span. Returns its id even when the emission is suppressed. */
  begin(
    name: string,
    kind: SpanKind,
    input: string,
    extra?: {
      model?: string;
      promptVersion?: string;
      attributes?: Record<string, string | number | boolean>;
    },
  ): string {
    const id = this.allocateId();
    if (this.isSuppressed(name)) return id;
    this.pending.set(id, {
      id,
      name,
      kind,
      startMs: this.ticks,
      input,
      model: extra?.model,
      promptVersion: extra?.promptVersion,
      attributes: extra?.attributes,
    });
    return id;
  }

  /** Close a span, stamping its output, usage and monotonic end time. */
  end(
    id: string,
    output: string,
    extra?: {
      usage?: SpanUsage;
      ok?: boolean;
      attributes?: Record<string, string | number | boolean>;
    },
  ): void {
    const span = this.pending.get(id);
    if (!span) return; // suppressed span: id consumed, nothing emitted
    this.pending.delete(id);
    const durationMs = span.kind === 'llm' ? 2 : 1;
    const endMs = this.ticks + durationMs;
    this.ticks = endMs;
    const emitted: TraceSpan = {
      id: span.id,
      parentId: span.id === this.rootId ? null : this.rootId,
      name: span.name,
      kind: span.kind,
      startMs: span.startMs,
      endMs,
      scenarioId: this.scenarioId,
      persona: this.persona,
      input: span.input,
      output,
    };
    if (span.model !== undefined) emitted.model = span.model;
    if (span.promptVersion !== undefined) emitted.promptVersion = span.promptVersion;
    const attributes = { ...span.attributes, ...extra?.attributes };
    if (extra?.ok !== undefined) attributes.ok = extra.ok;
    if (Object.keys(attributes).length > 0) emitted.attributes = attributes;
    if (extra?.usage) emitted.usage = { ...extra.usage };
    this.spanList.push(emitted);
  }

  /** Duration of a closed tool span, in ticks — used for ToolCallRecord.latencyMs. */
  durationOf(id: string): number {
    const span = this.spanList.find((s) => s.id === id);
    return span ? span.endMs - span.startMs : 0;
  }

  /** An emitted span by id, for `span` events streamed to a caller. */
  byId(id: string): TraceSpan | undefined {
    return this.spanList.find((s) => s.id === id);
  }

  /** Close the root span; every run must finish with exactly one call. */
  finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.end(this.rootId, 'agent.run complete');
  }

  private isSuppressed(spanName: string): boolean {
    // The bug is agent-side telemetry: only send_email is affected.
    return spanName === 'send_email' && this.bugFlags[BUG_UNLOGGED_TOOL_SPAN];
  }
}

/** Trace id helper, exported so traces and spans agree on the trc- prefix. */
export function traceIdFor(scenarioId: string): string {
  return `trc-${scenarioId}`;
}
