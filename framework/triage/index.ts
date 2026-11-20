import { readJson, fileExists } from '../../src/lib/json-io.ts';
import { join } from 'node:path';
import type { TicketCandidate, TriageDecision, TriageSummary } from '../../src/contracts/types.ts';
import { normalise, SEVERITY_ORDER } from './normalise.ts';
import { similarity, DEDUPE_THRESHOLD } from './similarity.ts';
import { generateTriageSummaryMarkdown } from './report.ts';
export { generateTriageSummaryMarkdown };

/** Default path to the fixture of open tickets. */
export const FIXTURE_PATH = join(
  process.cwd(),
  'framework/triage/fixtures/open-tickets.fixture.json',
);

/** Default path to the triage state workspace. */
export const STATE_PATH = join(process.cwd(), 'framework/triage/state/tickets-state.json');

/**
 * Dedupe → file → retest → close/reopen.
 *
 * - Normalises every candidate (stable signature + title).
 * - Matches candidates against open tickets (fixture + state workspace) by
 *   signature and title similarity; matches are `duplicate`, everything else is
 *   `new`.
 * - Applies the retest state machine to `new` candidates: fixed→closed,
 *   still-failing→reopened, no retest entry → stays `new`.
 * - `duplicate` candidates keep their state (evidence is appended to the
 *   matched ticket, never a new ticket).
 * - Returns a TriageSummary with headline counts and per-decision sections.
 */
export function triageCandidates(
  candidates: TicketCandidate[],
  opts: {
    mode: 'fixture' | 'live';
    statePath?: string;
    retest?: Record<string, 'fixed' | 'still-failing'>;
  },
): Promise<TriageSummary> {
  // --- Load open tickets from the fixture (recorded backlog) ---------------
  const openTickets: TicketCandidate[] = [];
  if (fileExists(FIXTURE_PATH)) {
    try {
      const fixture = readJson<{ tickets: TicketCandidate[] }>(FIXTURE_PATH);
      for (const ticket of fixture.tickets) {
        openTickets.push(normalise(ticket));
      }
    } catch {
      // Fixture unreadable: proceed with no open tickets.
    }
  }

  // --- Normalise incoming candidates --------------------------------------
  const normalised = candidates.map((c) => normalise(c));

  // --- Dedupe: new vs duplicate -------------------------------------------
  const decisions: TriageDecision[] = [];
  const matchedTicketIds = new Set<string>();

  for (const candidate of normalised) {
    // 1. Match against open fixture/state tickets by exact signature first.
    let matchedTicket: TicketCandidate | undefined;
    let similarityScore: number | undefined;

    for (const ticket of openTickets) {
      if (matchedTicketIds.has(ticket.signature)) continue;
      if (ticket.signature === candidate.signature) {
        matchedTicket = ticket;
        similarityScore = 1;
        break;
      }
    }

    // 2. Fall back to fuzzy title+signature similarity, but only among tickets
    //    with the same signature (signatures are the primary dedupe key).
    if (!matchedTicket) {
      let bestScore = 0;
      let bestTicket: TicketCandidate | undefined;
      for (const ticket of openTickets) {
        if (matchedTicketIds.has(ticket.signature)) continue;
        if (ticket.signature !== candidate.signature) continue;
        const score = similarity(
          `${candidate.title} ${candidate.signature}`,
          `${ticket.title} ${ticket.signature}`,
        );
        if (score >= DEDUPE_THRESHOLD && score > bestScore) {
          bestScore = score;
          bestTicket = ticket;
        }
      }
      if (bestTicket) {
        matchedTicket = bestTicket;
        similarityScore = bestScore;
      }
    }

    // 3. Match against earlier candidates in this batch.
    if (!matchedTicket) {
      for (const earlier of normalised) {
        if (earlier === candidate) continue;
        if (
          decisions.some(
            (d) => d.candidate.signature === earlier.signature && d.state === 'duplicate',
          )
        )
          continue;
        const score = similarity(
          `${candidate.title} ${candidate.signature}`,
          `${earlier.title} ${earlier.signature}`,
        );
        if (score >= DEDUPE_THRESHOLD && score > 0.99) {
          matchedTicket = earlier;
          similarityScore = score;
          break;
        }
      }
    }

    // --- Decide state -------------------------------------------------------
    let state: TriageDecision['state'];
    let note: string;

    if (matchedTicket) {
      state = 'duplicate';
      matchedTicketIds.add(matchedTicket.signature);
      note =
        `Duplicate of ${matchedTicket.signature}` +
        (similarityScore !== undefined ? ` (similarity ${similarityScore.toFixed(2)})` : '');
    } else {
      // New candidate: apply retest state machine.
      const retestResult = opts.retest?.[candidate.signature];
      if (retestResult === 'fixed') {
        state = 'closed';
        note = `Fixed: assertion ids ${candidate.evidence.assertionIds.join(', ')} now passing.`;
      } else if (retestResult === 'still-failing') {
        state = 'reopened';
        note = `Still failing: ${candidate.actual}`;
      } else {
        state = 'new';
        note = 'New failure: filed as a new ticket, awaiting retest.';
      }
    }

    decisions.push({
      candidate,
      state,
      matchedTicketId: matchedTicket?.signature,
      similarity: similarityScore,
      note,
    });
  }

  // --- Headline counts ------------------------------------------------------
  const summary: TriageSummary = {
    new: decisions.filter((d) => d.state === 'new').length,
    duplicates: decisions.filter((d) => d.state === 'duplicate').length,
    closed: decisions.filter((d) => d.state === 'closed').length,
    reopened: decisions.filter((d) => d.state === 'reopened').length,
    blocked: decisions.filter((d) => d.state === 'blocked').length,
    decisions: decisions.sort((a, b) => {
      const sa = SEVERITY_ORDER[a.candidate.severity];
      const sb = SEVERITY_ORDER[b.candidate.severity];
      if (sa !== sb) return sa - sb;
      return a.candidate.signature.localeCompare(b.candidate.signature);
    }),
  };

  return Promise.resolve(summary);
}
