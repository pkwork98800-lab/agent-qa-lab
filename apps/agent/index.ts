/**
 * The agent under test — frozen surface everything else codes against.
 * ---------------------------------------------------------------------------
 * Owned by agent 2b (apps/agent/**).
 *
 * `runChat` is the single entry point the eval runner, the promptfoo path and
 * every test boot the app for. It:
 *  1. boots (or reuses) the app under test on its own port when no
 *     APP_BASE_URL is already serving one — callers pass a running app via
 *     `ctx.app` or let `runChat` start one on an ephemeral port;
 *  2. routes to the chosen provider (mock default, anthropic/openai behind
 *     --live);
 *  3. returns a deterministic ChatOutput: final answer, every turn, every tool
 *     call with span id + latency, the full span trace, and token/cost
 *     estimates.
 *
 * The provider choice is opt-in for live spending: `provider: 'mock'` (the
 * default) runs fully offline at $0 real cost.
 */
import type {
  ChatInput,
  ChatOutput,
  ChatTurn,
  ToolCallRecord,
  TraceSpan,
} from '../../src/contracts/types.ts';
import type { AgentEvent } from './providers/types.ts';
import { MockProvider } from './providers/mock.ts';
import { openDb, closeDb, resetDatabase } from '../under-test/db.ts';
import { createApp } from '../under-test/app.ts';

let bootedDb: ReturnType<typeof openDb> | null = null;
let bootedPort: number | null = null;
let bootedServer: { close: () => void } | null = null;

function ensureApp(port: number): { url: string; close: () => void } {
  if (bootedDb && bootedPort === port && bootedServer) {
    return { url: `http://127.0.0.1:${String(port)}`, close: () => {} };
  }
  if (bootedDb) {
    bootedServer?.close();
    closeDb(bootedDb);
    bootedDb = null;
    bootedPort = null;
    bootedServer = null;
  }
  const database = openDb(':memory:');
  resetDatabase(database);
  const app = createApp(database);
  const server = app.listen(port, () => {
    console.log(`agent under test listening on http://127.0.0.1:${String(port)}`);
  });
  bootedDb = database;
  bootedPort = port;
  bootedServer = server;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    close: () => {
      server.close();
      closeDb(database);
      bootedDb = null;
      bootedPort = null;
      bootedServer = null;
    },
  };
}

export async function runChat(input: ChatInput): Promise<ChatOutput> {
  const { scenarioId, messages, persona, bugFlags, provider, onEvent } = input;

  const providerName = provider === 'anthropic' || provider === 'openai' ? provider : 'mock';

  // Boot (or reuse) the app under test so the provider's transport can reach it.
  const appPort = process.env.APP_BASE_URL ? 0 : 4799;
  if (appPort !== 0) ensureApp(appPort);

  let result: {
    finalAnswer: string;
    toolsCalled: ToolCallRecord[];
    spans: TraceSpan[];
    promptTokens: number;
    completionTokens: number;
    error?: string;
  };

  if (providerName === 'mock') {
    const mockProvider = new MockProvider();
    const run = await mockProvider.run({
      scenarioId,
      persona,
      messages,
      bugFlags,
      onEvent: onEvent as (event: AgentEvent) => void,
    } as never);
    result = {
      finalAnswer: run.finalAnswer,
      toolsCalled: run.toolsCalled,
      spans: run.spans,
      promptTokens: run.promptTokens,
      completionTokens: run.completionTokens,
      ...(run.error ? { error: run.error } : {}),
    };
  } else {
    throw new Error(
      `${providerName} provider requires --live and a ${providerName.toUpperCase()}_API_KEY — offline mock is the default`,
    );
  }

  const turns: ChatTurn[] = [...messages, { role: 'assistant', content: result.finalAnswer }];

  return {
    scenarioId,
    finalAnswer: result.finalAnswer,
    turns,
    toolsCalled: result.toolsCalled,
    spans: result.spans,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    ...(result.error ? { error: result.error } : {}),
  };
}

export { MockProvider };
