/**
 * Deterministic extractors for the mock policy engine.
 * ---------------------------------------------------------------------------
 * Owned by agent 2b (apps/agent/**).
 *
 * These turn an utterance into the arguments of a tool call: which stage, which
 * new contact, which line items, which new phone number. Every extractor is a
 * pure function with no randomness and no clock, so the same utterance always
 * produces the same arguments — which is what makes the mock provider
 * reproducible and debuggable.
 */
import type { SeedCompany } from './entity-index.ts';

export const STAGES = ['negotiation', 'proposal', 'qualification', 'won', 'lost'] as const;
export type Stage = (typeof STAGES)[number];

const QTY_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** Words that look like a quantity + noun but are not a line item. */
const NON_PRODUCT_WORDS = new Set([
  'extras',
  'extra',
  'line items',
  'items',
  'things',
  'stuff',
  'more',
  'changes',
  'both',
]);

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE_PATTERN = /\+\d[\d\s]{7,}/;

/** The stage the user wants, preferring an explicit "to <stage>". */
export function extractStage(lowered: string): Stage | undefined {
  const toStage = /\b(?:to|into)\s+(negotiation|proposal|qualification|won|lost)\b/.exec(lowered);
  if (toStage) return toStage[1] as Stage;
  for (const stage of STAGES) {
    if (new RegExp(`\\b${stage}\\b`).test(lowered)) return stage;
  }
  return undefined;
}

export function extractEmail(text: string): string | undefined {
  return EMAIL_PATTERN.exec(text)?.[0];
}

export function extractPhone(text: string): string | undefined {
  return PHONE_PATTERN.exec(text)?.[0];
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

/** "spare parts kits" → "Spare parts kits". */
export function titleCase(value: string): string {
  return capitalise(value.trim());
}

/** Drop a trailing plural so a draft line item can match a seeded product. */
export function singularise(product: string): string {
  const words = product.trim().toLowerCase().split(' ');
  const last = words[words.length - 1] ?? '';
  if (last.length > 3 && last.endsWith('s') && !last.endsWith('ss')) {
    words[words.length - 1] = last.slice(0, -1);
  }
  return words.join(' ');
}

export interface NewContactDraft {
  name?: string;
  companyId?: string;
  email?: string;
  phone?: string;
  role?: string;
}

/**
 * Pull a new contact out of an "add <name> as a contact under <company>" style
 * request. The company id comes from the resolved entity; the rest comes from
 * the utterance itself, so a brand-new contact can be created from a chat
 * message alone.
 */
export function extractNewContact(
  original: string,
  lowered: string,
  company: SeedCompany | undefined,
): NewContactDraft {
  const draft: NewContactDraft = {};
  const email = extractEmail(original);
  if (email) draft.email = email;
  const phone = extractPhone(original);
  if (phone) draft.phone = phone;

  const companyNames = new Set<string>();
  // The caller passes the resolved company; anything that matches a seeded
  // company name is a company, not a person.
  if (company) companyNames.add(company.name.toLowerCase());
  const nameMatch = /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/.exec(original);
  if (nameMatch && !companyNames.has(nameMatch[1].toLowerCase())) draft.name = nameMatch[1];

  const roleMatch = /\bas (?:an? )?([a-z][a-z\s-]+?)(?:[.,;]|$)/.exec(lowered);
  if (roleMatch) draft.role = titleCase(roleMatch[1]);

  if (company) draft.companyId = company.id;
  return draft;
}

export interface LineItemDraft {
  product: string;
  qty: number;
}

/**
 * Pull line-item drafts out of an utterance: "3 spare parts kits and one
 * priority support upgrade" → two drafts. Quantities are digits or the words
 * one..ten; the product is the noun phrase that follows.
 */
export function extractLineItems(original: string, lowered: string): LineItemDraft[] {
  const qty = `(\\d+|${Object.keys(QTY_WORDS).join('|')})`;
  const pattern = new RegExp(
    `${qty}\\s+([a-z][a-z0-9\\s-]*?)(?=\\s+and\\s+${qty}\\b|[,.:;]|$)`,
    'g',
  );
  const drafts: LineItemDraft[] = [];
  for (const match of lowered.matchAll(pattern)) {
    const qtyToken = match[1];
    const product = match[2].trim();
    if (!NON_PRODUCT_WORDS.has(product)) {
      drafts.push({
        qty: QTY_WORDS[qtyToken] ?? Number.parseInt(qtyToken, 10),
        product: titleCase(product),
      });
    }
  }
  return drafts;
}

/** The contact field an update utterance is about. */
export function extractContactField(lowered: string): string | undefined {
  if (/\b(phone|number|mobile)\b/.test(lowered)) return 'phone';
  if (/\b(e-?mail)\b/.test(lowered)) return 'email';
  if (/\b(job title|title|role)\b/.test(lowered)) return 'role';
  if (/\b(name)\b/.test(lowered)) return 'name';
  return undefined;
}

/** The new value for a contact field, from the utterance itself. */
export function extractNewValue(
  original: string,
  lowered: string,
  field: string,
): string | undefined {
  if (field === 'phone') return extractPhone(original);
  if (field === 'email') return extractEmail(original);
  const toMatch = /\bto\s+([A-Za-z][\w\s.-]+?)(?:[.,;]|$)/.exec(original);
  if (toMatch) return titleCase(toMatch[1]);
  const quoted = /"([^"]+)"/.exec(original);
  return quoted ? quoted[1] : undefined;
}

/** Normalise a product name for price matching against seeded line items. */
export function normaliseProduct(product: string): string {
  return singularise(product).toLowerCase();
}
