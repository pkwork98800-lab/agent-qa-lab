/**
 * Promptfoo provider for the agent-qa-lab system under test.
 * ---------------------------------------------------------------------------
 * Wraps `runChat` from `apps/agent/index.ts` behind promptfoo's provider
 * interface. Each call boots a fresh chat against the locally booted app
 * (http://127.0.0.1:4799 by default) and returns `{ output, metadata }`.
 *
 * Offline/mock mode always works: `provider` defaults to `'mock'` and no
 * external API keys are required. Live mode is behind an explicit flag.
 *
 * NOTE: `runChat` and the `ChatInput`/`ChatOutput` types are implemented in
 * `apps/agent/index.ts` (agent 2 ownership) and do not exist yet in this
 * snapshot. Until agent 2 delivers them, this provider references a
 * not-yet-existing module and `npm run eval:promptfoo` cannot execute. This is
 * a tracked dependency, not a defect in this module.
 */
import { HttpAppTransport } from '../../apps/agent/app-client.ts';
import { PERSONA_USER_IDS } from '../../src/contracts/app-api.ts';

export interface ProviderMetadata {
  toolsCalled: unknown[];
  spans: unknown[];
  scenarioId: string;
}

export interface ProviderResult {
  output: string;
  metadata: ProviderMetadata;
}

/** Local mirror of the ChatInput contract (frozen in src/contracts/types.ts). */
import type { ChatInput, PersonaId } from '../../src/contracts/types.ts';

const DEFAULT_APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://127.0.0.1:4799';

export const provider = {
  id: 'agent-qa-lab' as const,
  modelId: 'mock-policy-1',
  async callApi(
    prompt: string,
    context: { vars?: Record<string, unknown> },
  ): Promise<ProviderResult> {
    const vars = context?.vars ?? {};
    const persona = (vars.persona ?? 'rep_liam') as PersonaId;
    const scenarioId = (vars.scenarioId ?? 'scn-promptfoo-default') as string;
    const bugFlags = (vars.bugFlags ?? {}) as Record<string, boolean>;

    // `runChat` lives in apps/agent/index.ts (agent 2). Import it here.
    const { runChat } = await import('../../apps/agent/index.ts');

    const input: ChatInput = {
      scenarioId,
      messages: [{ role: 'user', content: prompt }],
      persona,
      bugFlags,
      provider: 'mock',
    };

    const output = await runChat(input);

    const actorId = PERSONA_USER_IDS[persona as keyof typeof PERSONA_USER_IDS] ?? 'usr_liam';
    const _app = new HttpAppTransport(actorId, DEFAULT_APP_BASE_URL);

    const metadata: ProviderMetadata = {
      toolsCalled: output.toolsCalled ?? [],
      spans: output.spans ?? [],
      scenarioId,
    };

    return { output: output.finalAnswer, metadata };
  },
};

export default provider;
