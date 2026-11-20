/**
 * Shared provider contracts.
 * ---------------------------------------------------------------------------
 * Owned by agent 2b (apps/agent/**).
 *
 * `LLMProvider` is the seam between the deterministic mock policy engine
 * (`providers/mock.ts`) and the real API paths (`providers/anthropic.ts`,
 * `providers/openai.ts`). All three execute tools through the same
 * `tool-executor.ts`, so the tool records, the guardrail and the span shape
 * are identical no matter which provider produced the answer.
 */
import type {
  ChatTurn,
  PersonaId,
  ToolCallRecord,
  ToolName,
  TraceSpan,
} from '../../../src/contracts/types.ts';
import type { AppTransport } from '../app-client.ts';
import type { SpanWriter } from '../spans.ts';

/** The frozen chat-message shape from BUILD-CONTRACT §6. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type Provider = 'mock' | 'anthropic' | 'openai';

/** Live events for a caller watching a run (spans + tool calls + answer). */
export type AgentEvent =
  | { type: 'span'; span: TraceSpan }
  | { type: 'tool-call'; name: ToolName; args: Record<string, unknown>; spanId: string }
  | { type: 'tool-result'; record: ToolCallRecord }
  | { type: 'answer'; answer: string };

export interface ProviderRun {
  id: string;
  modelId: string;
  finalAnswer: string;
  turns: ChatTurn[];
  toolsCalled: ToolCallRecord[];
  spans: TraceSpan[];
  promptTokens: number;
  completionTokens: number;
  error?: string;
}

/** The tool execution surface every provider shares. */
export interface ToolExecutionContext {
  scenarioId: string;
  persona: PersonaId;
  app: AppTransport;
  spans: SpanWriter;
  onEvent?: (event: AgentEvent) => void;
  /** The next 1-based sequence number for a tool call record. */
  nextSeq(): number;
  /** Set by the tool executor when the app cannot be reached at all. */
  fatal?: string;
}

/** What a provider needs from the harness to run one chat. */
export interface ProviderContext extends ToolExecutionContext {
  messages: ChatMessage[];
  bugFlags: Record<string, boolean>;
}

export interface LLMProvider {
  readonly id: Provider;
  readonly modelId: string;
  run(ctx: ProviderContext): Promise<ProviderRun>;
}
