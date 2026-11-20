/**
 * The ordered intent table — the behaviour of the mock policy engine.
 * ---------------------------------------------------------------------------
 * Owned by agent 2b (apps/agent/**).
 *
 * Intent detection scans the (lowercased, whitespace-normalised) user
 * utterance **in order** against the table below; the first rule that matches
 * wins. The ordering *is* the behaviour, so it is frozen here and documented
 * in `apps/agent/policy/README.md`:
 *
 *   1. create-line-items        (write, deal-scoped, most specific)
 *   2. update-deal-stage        (write, needs a deal AND a stage word)
 *   3. send-email-followup      (write, needs a contact AND a send verb)
 *   4. create-contact           (write, needs a create verb AND a contact noun)
 *   5. update-contact-generic   (write, needs a contact AND a field word)
 *   6. lookup-deal-by-id        (read, an exact dls_* id)
 *   7. lookup-deal-by-title     (read, a deal title/alias)
 *   8. lookup-contact           (read, a contact AND a question)
 *   9. lookup-company           (read, a company)
 *  10. hallucinated-fallback    (an id-like token the seed does not contain)
 *  11. not-found                (a lookup for a name the seed does not contain)
 *  12. clarify                  (nothing resolvable — ask, never guess)
 *
 * `permission-refusal` is not an utterance rule: it is the planning-time
 * override the planner applies when a gated intent is denied by the seeded
 * permission matrix. It is listed here so the table is a complete map of the
 * intents the engine can end up executing.
 *
 * Reads precede lookups and writes precede reads because a user asking to
 * "move that deal to negotiation" mentions both a deal and a stage, while a
 * user asking "what stage is dls_002 in?" mentions the same words in a
 * different order of intent. First match wins, deterministically.
 */
import {
  SEED_COMPANIES,
  SEED_CONTACTS,
  SEED_DEALS,
  type SeedCompany,
  type SeedContact,
  type SeedDeal,
} from './entity-index.ts';

export type IntentId =
  | 'lookup-contact'
  | 'lookup-deal-by-id'
  | 'lookup-deal-by-title'
  | 'lookup-company'
  | 'lookup-activity'
  | 'update-deal-stage'
  | 'update-contact-generic'
  | 'create-contact'
  | 'create-line-items'
  | 'send-email-followup'
  | 'permission-refusal'
  | 'clarify'
  | 'not-found'
  | 'hallucinated-fallback';

export type MatchKind = 'id' | 'name' | 'title' | 'word';

export interface MatchedContact {
  contact: SeedContact;
  matchedBy: MatchKind;
  position: number;
}

export interface MatchedCompany {
  company: SeedCompany;
  matchedBy: MatchKind;
  position: number;
}

export interface MatchedDeal {
  deal: SeedDeal;
  matchedBy: MatchKind;
  position: number;
}

export interface ResolvedEntities {
  contacts: MatchedContact[];
  companies: MatchedCompany[];
  deals: MatchedDeal[];
  /** Every `con_*`/`cmp_*`/`dls_*`/`inv_*`/`act_*`/`dli_*` token in the utterance. */
  recordIds: string[];
  /** Id-like tokens the seeded index does not know about. */
  unknownIds: string[];
  /** Capitalised two-word phrases that match no seeded record. */
  unknownNames: string[];
}

export interface IntentInput {
  /** The utterance exactly as the user typed it. */
  original: string;
  /** The utterance lowercased and whitespace-normalised. */
  lowered: string;
  entities: ResolvedEntities;
}

export interface IntentRule {
  id: IntentId;
  /** One-line prose: what the rule means, for the README and for reviewers. */
  description: string;
  detect(input: IntentInput): boolean;
}

// ---------------------------------------------------------------------------
// Vocabulary (word lists are part of the frozen behaviour)
// ---------------------------------------------------------------------------

const LINE_ITEM_NOUN = /\bline items?\b/;
const CREATE_VERB = /\b(add|create|new|register|onboard|insert)\b/;
const CONTACT_NOUN = /\bcontacts?\b/;
const APPEND_CUE = /\b(add|append|attach|extra|extras)\b/;
const MOVE_VERB = /\b(move|advance|set|change|update|transition|progress|bump|stage it|shift)\b/;
const STAGE_WORD = /\b(negotiation|proposal|qualification|won|lost)\b/;
const SEND_VERB = /\b(send|email|e-mail|draft|forward|follow ?up|write to|shoot)\b/;
const LOOKUP_QUESTION =
  /\b(who|which|what|what's|where|when|confirm|do we have|on file|details|tell me|show me|look ?up|find|search|pull up|give me|is she|is he)\b/;
const UPDATE_VERB = /\b(update|change|correct|fix|amend|edit|revise)\b/;
const CONTACT_FIELD = /\b(phone|number|email|e-mail|role|job title|title|name|company)\b/;

const ID_TOKEN = /\b(con|cmp|dls|inv|act|dli)_\d{3}\b/g;

// ---------------------------------------------------------------------------
// Entity resolution against the seed mirror
// ---------------------------------------------------------------------------

/** Lowercase, strip punctuation (keeping @ . _ - for ids and emails). */
export function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9@._\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phraseIndex(haystack: string, needle: string): number {
  const pattern = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const found = pattern.exec(haystack);
  return found ? found.index : -1;
}

/** Deal title aliases: the full title plus the two-word prefixes/suffixes. */
export function dealAliases(title: string): string[] {
  const lowered = title.toLowerCase();
  const words = lowered.split(' ');
  const aliases = new Set<string>([lowered]);
  if (words.length >= 3) {
    aliases.add(words.slice(0, 2).join(' '));
    aliases.add(words.slice(1).join(' '));
  }
  return [...aliases].filter((a) => a.split(' ').length >= 2 || a === lowered);
}

/** Company aliases: full name and the distinctive first word. */
export function companyAliases(company: SeedCompany): string[] {
  const lowered = company.name.toLowerCase();
  const words = lowered.split(' ');
  const aliases = new Set<string>([lowered]);
  if (words.length >= 2 && words[0].length >= 4) aliases.add(words[0]);
  return [...aliases];
}

/**
 * Resolve the utterance against the seed mirror. Matching is deterministic:
 * within each entity kind, exact ids win over names, and ties are broken by
 * the position of the match in the utterance.
 */
export function resolveEntities(original: string, lowered: string): ResolvedEntities {
  const contacts: MatchedContact[] = [];
  for (const contact of SEED_CONTACTS) {
    const idAt = phraseIndex(lowered, contact.id);
    if (idAt >= 0) {
      contacts.push({ contact, matchedBy: 'id', position: idAt });
      continue;
    }
    const nameAt = phraseIndex(lowered, contact.name.toLowerCase());
    if (nameAt >= 0) contacts.push({ contact, matchedBy: 'name', position: nameAt });
  }

  const companies: MatchedCompany[] = [];
  for (const company of SEED_COMPANIES) {
    const idAt = phraseIndex(lowered, company.id);
    if (idAt >= 0) {
      companies.push({ company, matchedBy: 'id', position: idAt });
      continue;
    }
    let best = -1;
    for (const alias of companyAliases(company)) {
      const at = phraseIndex(lowered, alias);
      if (at >= 0 && (best < 0 || at < best)) best = at;
    }
    if (best >= 0) companies.push({ company, matchedBy: 'name', position: best });
  }

  const deals: MatchedDeal[] = [];
  for (const deal of SEED_DEALS) {
    const idAt = phraseIndex(lowered, deal.id);
    if (idAt >= 0) {
      deals.push({ deal, matchedBy: 'id', position: idAt });
      continue;
    }
    let best = -1;
    for (const alias of dealAliases(deal.title)) {
      const at = phraseIndex(lowered, alias);
      if (at >= 0 && (best < 0 || at < best)) best = at;
    }
    if (best >= 0) deals.push({ deal, matchedBy: 'title', position: best });
  }

  const rank: Record<MatchKind, number> = { id: 0, title: 1, name: 2, word: 3 };
  contacts.sort((a, b) => rank[a.matchedBy] - rank[b.matchedBy] || a.position - b.position);
  companies.sort((a, b) => rank[a.matchedBy] - rank[b.matchedBy] || a.position - b.position);
  deals.sort((a, b) => rank[a.matchedBy] - rank[b.matchedBy] || a.position - b.position);

  const recordIds: string[] = [];
  for (const match of lowered.matchAll(ID_TOKEN)) recordIds.push(match[0]);

  const knownIds = new Set<string>([
    ...SEED_CONTACTS.map((c) => c.id),
    ...SEED_COMPANIES.map((c) => c.id),
    ...SEED_DEALS.map((d) => d.id),
  ]);
  const unknownIds = [...new Set(recordIds.filter((id) => !knownIds.has(id)))];

  const unknownNames: string[] = [];
  for (const match of original.matchAll(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g)) {
    const phrase = match[1];
    const loweredPhrase = phrase.toLowerCase();
    const known =
      SEED_CONTACTS.some((c) => c.name.toLowerCase() === loweredPhrase) ||
      SEED_COMPANIES.some((c) => c.name.toLowerCase() === loweredPhrase) ||
      SEED_DEALS.some((d) => d.title.toLowerCase() === loweredPhrase);
    if (!known && !unknownNames.includes(phrase)) unknownNames.push(phrase);
  }

  return { contacts, companies, deals, recordIds, unknownIds, unknownNames };
}

// ---------------------------------------------------------------------------
// The ordered table
// ---------------------------------------------------------------------------

export const INTENT_TABLE: readonly IntentRule[] = [
  {
    id: 'create-line-items',
    description:
      'A write that appends line items to a deal: the utterance names a deal (or "line items") and asks to add extras. Planned as permission check, one create_record per line item, then a verification read of the deal and its line items.',
    detect: (input) =>
      LINE_ITEM_NOUN.test(input.lowered) ||
      (input.entities.deals.length > 0 && APPEND_CUE.test(input.lowered)),
  },
  {
    id: 'update-deal-stage',
    description:
      'A write that moves a deal to a new stage. Needs a deal AND a stage word AND a move verb, so "what stage is dls_002 in?" stays a lookup.',
    detect: (input) =>
      input.entities.deals.length > 0 &&
      STAGE_WORD.test(input.lowered) &&
      MOVE_VERB.test(input.lowered),
  },
  {
    id: 'send-email-followup',
    description:
      'A write that emails a contact. Needs a resolved contact AND a send verb, and refuses to fire when the utterance is a question about a record (which is a lookup).',
    detect: (input) =>
      input.entities.contacts.length > 0 &&
      SEND_VERB.test(input.lowered) &&
      !LOOKUP_QUESTION.test(input.lowered),
  },
  {
    id: 'create-contact',
    description:
      'A write that adds a new contact: a create verb plus the noun "contact". The new contact is not in the seed, so the name/company/email are extracted from the utterance itself.',
    detect: (input) => CREATE_VERB.test(input.lowered) && CONTACT_NOUN.test(input.lowered),
  },
  {
    id: 'update-contact-generic',
    description:
      'A write that corrects a contact field (phone, email, role, name). Needs a resolved contact, an update verb and a field word.',
    detect: (input) =>
      input.entities.contacts.length > 0 &&
      UPDATE_VERB.test(input.lowered) &&
      CONTACT_FIELD.test(input.lowered),
  },
  {
    id: 'lookup-activity',
    description:
      'A read for an activity record (call/meeting/note). Matches when the user asks about an activity and a contact is resolved.',
    detect: (input) =>
      input.entities.contacts.length > 0 &&
      /\b(activity|call|meeting|note)\b/.test(input.lowered),
  },
  {
    id: 'lookup-deal-by-id',
    description: 'A read for a deal named by an exact dls_* id.',
    detect: (input) => input.entities.deals.some((d) => d.matchedBy === 'id'),
  },
  {
    id: 'lookup-deal-by-title',
    description:
      'A read for a deal named by title or a title alias ("predictive maintenance" for dls_001).',
    detect: (input) => input.entities.deals.some((d) => d.matchedBy === 'title'),
  },
  {
    id: 'lookup-contact',
    description:
      'A read about a contact: which company, which email, which phone, who they are. Needs a resolved contact and question phrasing.',
    detect: (input) => input.entities.contacts.length > 0 && LOOKUP_QUESTION.test(input.lowered),
  },
  {
    id: 'lookup-company',
    description: 'A read about a company: name, industry or region.',
    detect: (input) => input.entities.companies.length > 0,
  },
  {
    id: 'hallucinated-fallback',
    description:
      'An id-like token the seeded index does not know (dls_999). The agent performs exactly one search and then quotes only what the tool returned; when the app invents a record the answer says so instead of elaborating.',
    detect: (input) => input.entities.unknownIds.length > 0,
  },
  {
    id: 'not-found',
    description:
      'A lookup for a plausible name that the seed does not contain. The agent searches once and reports that the record does not exist.',
    detect: (input) =>
      LOOKUP_QUESTION.test(input.lowered) && input.entities.unknownNames.length > 0,
  },
  {
    id: 'clarify',
    description:
      'Nothing resolvable and no clear action: the agent asks one clarifying question and performs no tool calls and no writes.',
    detect: () => true,
  },
  {
    id: 'permission-refusal',
    description:
      'Planning-time override (not matched from the utterance): a write or a read the seeded matrix denies. The agent calls check_permissions, records the verdict, writes nothing, and explains the refusal with the permission reason.',
    detect: () => false,
  },
];

/** First match wins — the ordering above is the behaviour. */
export function detectIntent(input: IntentInput): IntentId {
  for (const rule of INTENT_TABLE) {
    if (rule.detect(input)) return rule.id;
  }
  // Unreachable: `clarify` always matches.
  return 'clarify';
}
