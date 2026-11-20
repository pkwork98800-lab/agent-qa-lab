import type { Severity, TicketCandidate } from '../../src/contracts/types.ts';

/** Error classes recognised from a failure message. */
export type ErrorClass =
  | 'missing-span'
  | 'field-mismatch'
  | 'permission-leak'
  | 'hallucination'
  | 'partial-write'
  | 'other';

/** Error-class keywords, longest match wins. */
const ERROR_CLASS_KEYWORDS: Record<ErrorClass, string[]> = {
  'missing-span': ['span', 'unlogged', 'missing guardrail', 'guardrail span'],
  'field-mismatch': ['field', 'mismatch', 'expected', 'actual'],
  'permission-leak': ['permission', 'role', 'deny', 'escalation', 'tenant'],
  hallucination: ['invent', 'hallucin', 'not-found', 'plausible', 'fallback'],
  'partial-write': ['drop', 'last', 'partial', 'total', 'line item'],
  other: [],
};

/** Map a failure message to an error class. */
export function errorClassFor(message: string): ErrorClass {
  const lower = message.toLowerCase();
  let best: ErrorClass = 'other';
  let bestLength = 0;
  for (const [klass, keywords] of Object.entries(ERROR_CLASS_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword) && keyword.length > bestLength) {
        best = klass as ErrorClass;
        bestLength = keyword.length;
      }
    }
  }
  return best;
}

/** Stable dedupe signature: scenarioId|source|errorClass. */
export function signatureFor(candidate: TicketCandidate): string {
  return `${candidate.scenarioId}|${candidate.source}|${errorClassFor(candidate.actual)}`;
}

/** Imperative title naming the component and the observable failure. */
export function titleFrom(candidate: TicketCandidate): string {
  const klass = errorClassFor(candidate.actual);
  const component =
    klass === 'missing-span' ? 'guardrail span' : klass === 'other' ? 'behaviour' : klass;
  return `${candidate.source}: ${candidate.scenarioId} — ${component} (${klass})`;
}

export interface NormalisedCandidate extends TicketCandidate {
  signature: string;
  title: string;
}

/** Normalise a candidate: fill stable signature and title if missing. */
export function normalise(candidate: TicketCandidate): NormalisedCandidate {
  return {
    ...candidate,
    signature: candidate.signature || signatureFor(candidate),
    title: candidate.title || titleFrom(candidate),
  };
}

/** Severity order for stable sorting. */
export const SEVERITY_ORDER: Record<Severity, number> = {
  blocker: 0,
  major: 1,
  minor: 2,
};
