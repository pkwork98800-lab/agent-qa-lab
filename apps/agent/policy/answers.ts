/**
 * Answer templates — the grounded-answer half of the mock policy.
 * ---------------------------------------------------------------------------
 * Owned by agent 2b (apps/agent/**).
 *
 * Every function here renders text from **tool results only** (a record is a
 * parsed JSON body from one of the six tools). Nothing is stated that a tool
 * did not return, and no write is claimed unless the tool that performed it
 * returned ok. Where the agent has to make a judgement (a missing unit price,
 * an unverifiable record) the answer says so instead of inventing a fact.
 */
import { formatMoney } from './money.ts';

/** A tool result row, as returned by the app. */
export type Record_ = Record<string, unknown>;

export function str(record: Record_ | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** `read_only` reads as "read-only" in prose. */
export function humanRole(role: string): string {
  return role.replace(/_/g, '-');
}

export function num(record: Record_ | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' ? value : undefined;
}

function label(record: Record_): string {
  return str(record, 'name') ?? str(record, 'title') ?? str(record, 'id') ?? 'record';
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function contactAnswer(contact: Record_, company?: Record_): string {
  const name = str(contact, 'name') ?? label(contact);
  const id = str(contact, 'id') ?? '';
  const role = str(contact, 'role');
  const email = str(contact, 'email');
  const industry = str(company, 'industry');
  const region = str(company, 'region');
  const where = company
    ? ` at ${str(company, 'name') ?? label(company)}${industry ? ` (${industry}, ${region ?? 'unknown region'})` : ''}`
    : ` under company ${str(contact, 'companyId') ?? 'unknown'}`;
  const parts: string[] = [];
  parts.push(`${name}${id ? ` (${id})` : ''} is${role ? ` ${role}` : ' on file'}${where}.`);
  if (email) parts.push(`The email address on file is ${email}.`);
  return parts.join(' ');
}

export function companyAnswer(company: Record_): string {
  const name = str(company, 'name') ?? label(company);
  const id = str(company, 'id') ?? '';
  return `${name}${id ? ` (${id})` : ''} — industry ${str(company, 'industry') ?? 'unknown'}, region ${str(company, 'region') ?? 'unknown'}.`;
}

export function dealAnswer(deal: Record_, company?: Record_): string {
  const title = str(deal, 'title') ?? label(deal);
  const id = str(deal, 'id') ?? '';
  const stage = str(deal, 'stage') ?? 'unknown stage';
  const amount = num(deal, 'amountCents');
  const currency = str(deal, 'currency') ?? 'EUR';
  const owner = str(deal, 'ownerId');
  const companyBit = company ? ` for ${str(company, 'name') ?? label(company)}` : '';
  const amountBit =
    amount !== undefined ? ` worth ${formatMoney(amount, currency)} (${currency}) ${amount} cents` : '';
  const ownerBit = owner ? `, owned by ${owner}` : '';
  return `${title}${id ? ` (${id})` : ''}${companyBit} — stage ${stage}${amountBit}${ownerBit}.`;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export function stageUpdateAnswer(deal: Record_, fromStage: string, toStage: string): string {
  const title = str(deal, 'title') ?? label(deal);
  const id = str(deal, 'id') ?? '';
  const amount = num(deal, 'amountCents');
  const currency = str(deal, 'currency') ?? 'EUR';
  const stage = str(deal, 'stage') ?? toStage;
  const amountBit =
    amount !== undefined ? ` The amount is unchanged at ${formatMoney(amount, currency)}.` : '';
  return stage === toStage
    ? `Done — ${title}${id ? ` (${id})` : ''} is now in ${stage}; it was ${fromStage} before.${amountBit}`
    : `I asked the app to move ${title}${id ? ` (${id})` : ''} to ${toStage}, but it now reads ${stage}. Please check the record.`;
}

export function contactUpdateAnswer(contact: Record_, field: string, value: string): string {
  const name = str(contact, 'name') ?? label(contact);
  const id = str(contact, 'id') ?? '';
  const current = str(contact, field);
  return `Done — ${name}${id ? ` (${id})` : ''} now has ${field} ${value}${
    current ? ` (was ${current})` : ''
  }. The app returned the updated record.`;
}

export function createContactAnswer(contact: Record_): string {
  const name = str(contact, 'name') ?? label(contact);
  const id = str(contact, 'id') ?? '';
  const email = str(contact, 'email');
  const company = str(contact, 'companyId');
  return `Done — the contact ${name}${id ? ` (${id})` : ''} was added under ${company ?? 'the company you named'}${
    email ? ` with email ${email}` : ''
  }. The app returned the new record.`;
}

export interface LineItemDraftView {
  product: string;
  qty: number;
  unitCents: number;
  currency: string;
  /** Where the unit price came from, when the utterance did not give one. */
  priceBasis?: string;
}

export interface LineItemsOutcomeView {
  dealId: string;
  dealTitle: string;
  requested: LineItemDraftView[];
  /** Every line item on the deal after the writes, as read back from the app. */
  persisted: Record_[];
  dealAfter: Record_ | undefined;
  /** Sum of `persisted` line-item totals, in cents. */
  sumCents: number;
}

export function lineItemsAnswer(view: LineItemsOutcomeView): string {
  const requestedText = view.requested
    .map(
      (item) =>
        `${String(item.qty)} × ${item.product} @ ${formatMoney(item.unitCents, item.currency)}${
          item.priceBasis ? ` (${item.priceBasis})` : ''
        }`,
    )
    .join(' and ');
  const totalAfter = num(view.dealAfter, 'amountCents');
  const currency = str(view.dealAfter, 'currency') ?? 'EUR';

  if (totalAfter === undefined) {
    return `I asked the app to add ${String(view.requested.length)} line items to ${view.dealId} (${view.dealTitle}): ${requestedText}. I could not read the deal back, so I cannot confirm the total.`;
  }

  if (view.sumCents === totalAfter) {
    return `Added ${String(view.requested.length)} line items to ${view.dealId} (${view.dealTitle}): ${requestedText}. The deal now carries ${String(view.persisted.length)} line items and a total of ${formatMoney(totalAfter, currency)}, which matches the sum of its line items — total consistent.`;
  }

  const seeded = view.persisted.length - view.requested.length;
  const persistedNew = view.persisted.length - Math.max(0, seeded);
  const lost = view.requested.length - persistedNew;
  return `I asked the app to add ${String(view.requested.length)} line items to ${view.dealId} (${view.dealTitle}): ${requestedText}. Only ${String(persistedNew)} line item${persistedNew === 1 ? '' : 's'} was persisted${
    lost > 0 ? ` — ${String(lost)} write${lost === 1 ? '' : 's'} lost` : ''
  }. The deal now carries ${String(view.persisted.length)} line items and its total reads ${formatMoney(totalAfter, currency)}, which does not match the sum of its line items (${formatMoney(view.sumCents, currency)}). The write looks partial — flagging for review.`;
}

export function emailAnswer(email: Record_): string {
  const to = str(email, 'to') ?? 'the recipient';
  const subject = str(email, 'subject');
  const id = str(email, 'id');
  return `Done — I emailed ${to}${subject ? ` with subject "${subject}"` : ''}.${
    id ? ` The app queued it to the outbox as ${id}.` : ''
  }`;
}

export function activityAnswer(activity: Record<string, unknown>, contactName?: string): string {
  const type = str(activity, 'type') ?? 'activity';
  const id = str(activity, 'id') ?? '';
  const happenedOn = str(activity, 'happenedOn') ?? '';
  const notes = str(activity, 'notes') ?? '';
  const contactBit = contactName ? ` with ${contactName}` : '';
  return `${type.charAt(0).toUpperCase() + type.slice(1)} ${id}${contactBit} on ${happenedOn}: ${notes}.`;
}

// ---------------------------------------------------------------------------
// Refusals, gaps and failures
// ---------------------------------------------------------------------------

export function writeRefusal(opts: {
  /** The verb phrase a human would use ("create", "update", "send an email to"). */
  verbPhrase: string;
  action: string;
  resource: string;
  role: string;
  reason: string;
  target: string;
  appAllowed: boolean;
}): string {
  const discrepancy = opts.appAllowed
    ? ' Note: the permission endpoint reported allowed for that action, which contradicts this role — I refused anyway and flagged the discrepancy.'
    : '';
  return `Refusal: I cannot ${opts.verbPhrase} that ${opts.target}. Your role is ${humanRole(opts.role)} and the permission matrix denies ${opts.action} on ${opts.resource}; the permission check returned denied${
    opts.reason ? ` (${opts.reason})` : ''
  }.${discrepancy} No record was written.`;
}

export function readRefusal(opts: {
  action: string;
  resource: string;
  role: string;
  reason: string;
  scopeCompany: string | null;
  targetHint: string;
  appAllowed: boolean;
}): string {
  const scope = opts.scopeCompany
    ? `Your access is scoped to ${opts.scopeCompany} only, so there are no ${opts.targetHint} numbers I can retrieve for you.`
    : `Your access does not cover ${opts.resource} records.`;
  const discrepancy = opts.appAllowed
    ? ' Note: the permission endpoint reported allowed for that action, which contradicts this role — I refused anyway and flagged the discrepancy.'
    : '';
  return `Refusal: I cannot look that up. ${scope} The permission check for ${opts.action} on ${opts.resource} was denied for role ${humanRole(opts.role)}${
    opts.reason ? ` (${opts.reason})` : ''
  }.${discrepancy}`;
}

export function notFoundAnswer(query: string, kind: string): string {
  return `I searched for ${query} and found no matching ${kind} record, so there is nothing to report. I changed nothing.`;
}

export function unverifiedAnswer(query: string, record: Record_): string {
  const id = str(record, 'id');
  return `The app returned a record for ${query} that is not in the seeded reference data: ${label(record)}${
    id ? ` (${id})` : ''
  }. I am quoting exactly what the tool returned and cannot verify it — please treat it as unconfirmed.`;
}

export function answerUnavailableAnswer(what: string, detail: string): string {
  return `I could not ${what}: ${detail} Nothing was written.`;
}

export function clarifyAnswer(): string {
  return 'Happy to help. Which record do you mean — a contact name, a company, or a record id like dls_002? And what would you like done with it?';
}
