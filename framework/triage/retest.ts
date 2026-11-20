import type { TicketCandidate, TriageState } from '../../src/contracts/types.ts';

/** Outcome of the retest state machine applied to one candidate. */
export interface RetestOutcome {
  candidate: TicketCandidate;
  state: TriageState;
  matchedTicketId?: string;
  note: string;
}

/**
 * Retest state machine (agent-8-triage §retest.ts).
 *
 * Given `retest: Record<signature, 'fixed' | 'still-failing'>` produced by the
 * orchestrator re-running failed scenarios:
 *
 * - fixed        → state `closed`, comment with proof (assertion ids now passing + run id)
 * - still-failing → state `reopened`, comment with new evidence
 * - no entry     → state `new` (stays new, awaiting retest)
 *
 * Signature matching against open tickets decides `new` vs `duplicate`;
 * duplicates get a comment with new evidence appended, never a new ticket.
 */
export function retestCandidates(
  candidates: TicketCandidate[],
  retest: Record<string, 'fixed' | 'still-failing'>,
): RetestOutcome[] {
  const outcomes: RetestOutcome[] = [];

  for (const candidate of candidates) {
    const hasEntry = Object.hasOwn(retest, candidate.signature);
    const outcome = hasEntry ? retest[candidate.signature] : undefined;

    let state: TriageState;
    let note: string;

    if (outcome === 'fixed') {
      state = 'closed';
      note = `Fixed: assertion ids ${candidate.evidence.assertionIds.join(', ')} now passing.`;
    } else if (outcome === 'still-failing') {
      state = 'reopened';
      note = `Still failing: ${candidate.actual}. New evidence appended.`;
    } else {
      // No retest entry: stays new, awaiting retest.
      state = 'new';
      note = 'New failure: filed as a new ticket, awaiting retest.';
    }

    outcomes.push({ candidate, state, note });
  }

  return outcomes;
}
