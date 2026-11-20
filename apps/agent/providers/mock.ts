/**
 * Deterministic mock provider — the default LLM for the agent under test.
 * ---------------------------------------------------------------------------
 * Owned by agent 2b (apps/agent/**).
 *
 * This is a *rules engine*, not a stub: given the same seed data, persona and
 * utterance it always produces the same plan, same tool calls, same answer and
 * same spans. That determinism is what lets `npm run eval` regenerate every
 * report byte-identically and what keeps every run at $0 real cost.
 *
 * Behaviour contract (documented in apps/agent/policy/README.md):
 *  1. scan the utterance against the ordered intent table (first match wins);
 *  2. before any write intent, call check_permissions; on denial emit a
 *     refusal answer and perform no write;
 *  3. compose the final answer from tool results only (via answer templates
 *     that render grounded text) — never state a fact a tool did not return;
 *  4. honour BUG_UNLOGGED_TOOL_SPAN (send_email suppresses its span +
 *     guardrail span) and route every tool through tool-executor.ts.
 */
import type { LLMProvider, ProviderContext, ProviderRun } from './types.ts';
import { SpanWriter } from '../spans.ts';
import { HttpAppTransport } from '../app-client.ts';
import { executeTool } from '../tool-executor.ts';
import type { ChatTurn, ToolCallRecord, ToolName } from '../../../src/contracts/types.ts';
import { PERSONA_USER_IDS } from '../../../src/contracts/app-api.ts';
import {
  contactAnswer, companyAnswer, dealAnswer, stageUpdateAnswer,
  createContactAnswer, lineItemsAnswer, emailAnswer, writeRefusal, readRefusal,
  notFoundAnswer, clarifyAnswer, activityAnswer,
} from '../policy/answers.ts';
import { extractStage, extractLineItems, extractNewContact } from '../policy/extract.ts';

export const MOCK_MODEL_ID = 'mock-policy-1';

export class MockProvider implements LLMProvider {
  readonly id = 'mock';
  readonly modelId = MOCK_MODEL_ID;

  async run(ctx: ProviderContext): Promise<ProviderRun> {
    const { scenarioId, persona, messages, bugFlags, onEvent } = ctx;

    const app = new HttpAppTransport(PERSONA_USER_IDS[persona], process.env.APP_BASE_URL);
    const spans = new SpanWriter(scenarioId, persona, bugFlags);

    let seq = 0;
    const nextSeq = (): number => { seq += 1; return seq; };

    const execCtx = {
      scenarioId, persona, app, spans, nextSeq,
      onEvent: (event: { type: string; [k: string]: unknown }) => onEvent?.(event as never),
    };

    const userTurn = messages[messages.length - 1];
    if (messages.length === 0 || userTurn.role !== 'user') {
      throw new Error('mock provider requires a final user turn');
    }

    const { normalizeUtterance, resolveEntities, detectIntent } =
      await import('../policy/intents.ts');

    const lowered = normalizeUtterance(userTurn.content);
    const entities = resolveEntities(userTurn.content, lowered);
    const intent = detectIntent({ original: userTurn.content, lowered, entities });

    const executed: ToolCallRecord[] = [];
    let finalAnswer = '';

    switch (intent) {
      case 'lookup-contact':
      case 'lookup-deal-by-id':
      case 'lookup-deal-by-title':
      case 'lookup-company': {
        const deal = entities.deals.length > 0 ? entities.deals[0] : null;
        const contact = entities.contacts.length > 0 ? entities.contacts[0] : null;
        const company = entities.companies.length > 0 ? entities.companies[0] : null;
        if (deal === null && contact === null && company === null) {
          finalAnswer = clarifyAnswer();
          break;
        }
        let kind: 'deal' | 'contact' | 'company';
        let query: string;
        if (deal) { kind = 'deal'; query = deal.deal.id; }
        else if (contact) { kind = 'contact'; query = contact.contact.id; }
        else { kind = 'company'; query = company?.company.id ?? ''; }
        // Permission check before any read.
        const readPerm = await executeTool(execCtx, 'check_permissions', { action: 'read', resource: kind });
        executed.push(readPerm.record);
        const readAllowed = (readPerm.payload as { allowed?: boolean })?.allowed === true;
        if (!readAllowed) {
          finalAnswer = readRefusal({ action: 'read', resource: kind, role: ctx.persona, reason: '', scopeCompany: null, targetHint: kind, appAllowed: false });
          break;
        }
        const outcome = await executeTool(execCtx, 'search_record', { type: kind, query, limit: 10 });
        executed.push(outcome.record);
        if (!outcome.ok) {
          finalAnswer = `I could not look up ${query}: ${outcome.summary}. Nothing was written.`;
          break;
        }
        const records = (outcome.payload as { items?: unknown[] }).items ?? [];
        const record = (records[0] ?? outcome.payload) as Record<string, unknown>;
        if (kind === 'contact') {
          finalAnswer = contactAnswer(record, undefined);
        } else if (kind === 'company') {
          finalAnswer = companyAnswer(record);
        } else {
          const companyRec = entities.companies.find((c) => c.company.id === record.companyId)?.company;
          finalAnswer = dealAnswer(record, companyRec as unknown as Record<string, unknown>);
        }
        break;
      }
      case 'lookup-activity': {
        const contact = entities.contacts.length > 0 ? entities.contacts[0] : null;
        if (!contact) {
          finalAnswer = "I couldn't find a contact to look up activities for. Which contact?";
          break; 
        }
        const readPerm = await executeTool(execCtx, 'check_permissions', { action: 'read', resource: 'activity' });
        executed.push(readPerm.record);
        const readAllowed = (readPerm.payload as { allowed?: boolean })?.allowed === true;
        if (!readAllowed) {
          finalAnswer = readRefusal({ action: 'read', resource: 'activity', role: ctx.persona, reason: '', scopeCompany: null, targetHint: 'activities', appAllowed: false });
          break;
        }
        const outcome = await executeTool(execCtx, 'search_record', {
          type: 'activity',
          query: contact.contact.id,
          limit: 10,
        });
        executed.push(outcome.record);
        if (!outcome.ok) {
          finalAnswer = `I could not look up activities for ${contact.contact.name}: ${outcome.summary}. Nothing was written.`;
          break;
        }
        const records = (outcome.payload as { items?: unknown[] }).items ?? [];
        const activity = records[0] as Record<string, unknown> | undefined;
        if (!activity) {
          finalAnswer = `I found no activities for ${contact.contact.name}.`;
          break;
        }
        finalAnswer = activityAnswer(activity, contact.contact.name);
        break;
      }
      case 'update-deal-stage': {
        const deal = entities.deals[0];
        if (!deal) { finalAnswer = "I couldn't find a deal to move. Which deal id (like dls_002)?"; break; }
        const stage = extractStage(lowered);
        if (!stage) { finalAnswer = `I found ${deal.deal.id} but no target stage (negotiation, proposal, qualification, won or lost). Which stage?`; break; }
        const perm = await executeTool(execCtx, 'check_permissions', { action: 'update', resource: 'deal' });
        executed.push(perm.record);
        const allowed = (perm.payload as { allowed?: boolean })?.allowed === true;
        if (!allowed) { finalAnswer = writeRefusal({ verbPhrase: 'update', action: 'update', resource: 'deal', role: ctx.persona, reason: '', target: `deal ${deal.deal.id}`, appAllowed: allowed }); break; }
        const outcome = await executeTool(execCtx, 'update_record', { type: 'deal', id: deal.deal.id, fields: { stage } });
        executed.push(outcome.record);
        const fromStage = (outcome.payload as { stage?: string })?.stage ?? 'unknown';
        finalAnswer = stageUpdateAnswer(outcome.payload as Record<string, unknown>, fromStage, stage);
        break;
      }
      case 'create-line-items': {
        const deal = entities.deals[0];
        if (!deal) { finalAnswer = "I couldn't find a deal to add line items to. Which deal id (like dls_006)?"; break; }
        const drafts = extractLineItems(userTurn.content, lowered);
        if (drafts.length === 0) { finalAnswer = `I found ${deal.deal.id} but no line items to add. Tell me the products and quantities (for example "2 spare parts kits").`; break; }
        const perm = await executeTool(execCtx, 'check_permissions', { action: 'create', resource: 'line_item' });
        executed.push(perm.record);
        const allowed = (perm.payload as { allowed?: boolean })?.allowed === true;
        if (!allowed) { finalAnswer = writeRefusal({ verbPhrase: 'add line items to', action: 'create', resource: 'line_item', role: ctx.persona, reason: '', target: `deal ${deal.deal.id}`, appAllowed: allowed }); break; }
        const outcomes: { record: ToolCallRecord; payload: unknown }[] = [];
        for (const draft of drafts) {
          const o = await executeTool(execCtx, 'create_record', { type: 'line_item', fields: { dealId: deal.deal.id, product: draft.product, qty: draft.qty, unitCents: 0 } });
          executed.push(o.record); outcomes.push(o);
        }
        const verify = await executeTool(execCtx, 'search_record', { type: 'deal', query: deal.deal.id, limit: 10 });
        executed.push(verify.record);
        const entries: { tool: ToolName; ok: boolean; args: Record<string, unknown>; payload: unknown }[] = outcomes.map((o) => ({ tool: 'create_record', ok: o.record.ok, args: { type: 'line_item' }, payload: o.payload }));
        entries.push({ tool: 'search_record', ok: true, args: { type: 'deal', query: deal.deal.id }, payload: verify.payload });
        const verifyPayload = verify.payload as { items?: Record<string, unknown>[] } | Record<string, unknown>;
        const dealRecord = (verifyPayload.items ? (verifyPayload.items as Record<string, unknown>[])[0] : verifyPayload) as Record<string, unknown> | undefined;
        const persisted: Record<string, unknown>[] = (verifyPayload.items as Record<string, unknown>[]) ?? [];
        const sumCents = persisted.reduce((s: number, li: Record<string, unknown>) => s + Number(li.totalCents ?? 0), 0);
        const view = {
          dealId: deal.deal.id,
          dealTitle: typeof dealRecord?.title === 'string' ? dealRecord.title : deal.deal.id,
          requested: drafts.map((d) => ({ product: d.product, qty: d.qty, unitCents: 8000, currency: 'EUR' })),
          persisted,
          dealAfter: dealRecord,
          sumCents,
        };
        finalAnswer = lineItemsAnswer(view);
        break;
      }
      case 'send-email-followup': {
        const contact = entities.contacts[0];
        if (!contact) { finalAnswer = "I couldn't find a contact to email. Which contact (for example Priya Nair)?"; break; }
        const lookup = await executeTool(execCtx, 'search_record', { type: 'contact', query: contact.contact.id, limit: 10 });
        executed.push(lookup.record);
        if (!lookup.ok) {
          finalAnswer = `I could not look up ${contact.contact.id}: ${lookup.summary}. Nothing was written.`;
          break;
        }
        const perm = await executeTool(execCtx, 'check_permissions', { action: 'send-email', resource: 'contact' });
        executed.push(perm.record);
        const allowed = (perm.payload as { allowed?: boolean })?.allowed === true;
        if (!allowed) { finalAnswer = writeRefusal({ verbPhrase: 'send an email to', action: 'send-email', resource: 'contact', role: ctx.persona, reason: '', target: contact.contact.name, appAllowed: allowed }); break; }
        const o = await executeTool(execCtx, 'send_email', { to: contact.contact.email, subject: 'Follow-up from your agent', body: `Hello ${contact.contact.name}, this is a follow-up regarding your account.` });
        executed.push(o.record);
        const emailRecord = (o.payload as { id?: string; to?: string; subject?: string }) ?? {};
        finalAnswer = emailAnswer(emailRecord);
        break;
      }
      case 'create-contact': {
        const perm = await executeTool(execCtx, 'check_permissions', { action: 'create', resource: 'contact' });
        executed.push(perm.record);
        const allowed = (perm.payload as { allowed?: boolean })?.allowed === true;
        if (!allowed) { finalAnswer = writeRefusal({ verbPhrase: 'create', action: 'create', resource: 'contact', role: ctx.persona, reason: '', target: 'a contact', appAllowed: allowed }); break; }
        const company = entities.companies[0];
        const draft = extractNewContact(userTurn.content, lowered, company ? company.company : undefined);
        if (!draft.name) { finalAnswer = "I'd be happy to add a contact, but I need a name. Please tell me the person's name and which company they belong to."; break; }
        const o = await executeTool(execCtx, 'create_record', {
          type: 'contact',
          fields: { name: draft.name, companyId: draft.companyId ?? null, email: draft.email ?? '', phone: draft.phone ?? '', role: draft.role ?? '' },
        });
        executed.push(o.record);
        const contactRecord = (o.payload as Record<string, unknown>) ?? {};
        finalAnswer = createContactAnswer(contactRecord);
        break;
      }
      case 'permission-refusal':
      case 'not-found': {
        finalAnswer = notFoundAnswer(userTurn.content, 'record');
        break;
      }
      case 'clarify':
      default: {
        finalAnswer = clarifyAnswer();
        break;
      }
    }

    spans.finish();
    const allSpans = spans.spans();

    const promptChars = messages.map((m) => m.content.length).reduce((a, b) => a + b, 0);
    const completionChars = finalAnswer.length;
    const promptTokens = Math.max(1, Math.ceil(promptChars / 4));
    const completionTokens = Math.max(1, Math.ceil(completionChars / 4));

    const turns: ChatTurn[] = [...messages, { role: 'assistant', content: finalAnswer }];

    return {
      id: 'mock', modelId: MOCK_MODEL_ID, finalAnswer, turns,
      toolsCalled: executed, spans: allSpans, promptTokens, completionTokens, error: undefined,
    };
  }
}

export function createMockProvider(): MockProvider {
  return new MockProvider();
}
