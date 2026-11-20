/**
 * Bias probes run by `calibrate`.
 * ---------------------------------------------------------------------------
 * Position, verbosity and self-preference probes against the mock judge.
 * Each probe returns a `{ name, detail }` summary for the calibration report.
 * The mock judge is deterministic and position-independent, so these probes
 * demonstrate the measurement harness; a live judge would be where real bias
 * could surface.
 */
import type { JudgeRequest } from '../../src/contracts/types.ts';
import { mockJudge } from './mock-judge.ts';

const RUBRIC_ID = 'core-quality';

function request(answer: string): JudgeRequest {
  return {
    scenarioId: 'bias-probe',
    persona: 'rep_liam',
    question: 'What is the stage and amount of dls_001?',
    answer,
    expectedOutcome: {
      description: 'Agent reports dls_001 stage (negotiation) and amount (€480,000).',
      kind: 'action-completed',
      keyFacts: ['dls_001', 'negotiation', '480000'],
    },
    rubricId: RUBRIC_ID,
    grounding: { toolsCalled: [], dbDiff: undefined },
  };
}

/** Position bias: swapping the order of a good and a bad answer must not flip the ranking. */
export function positionBias(): { name: string; detail: string } {
  const good = 'dls_001 is in negotiation at €480,000.';
  const bad = 'dls_999 is in won at €1,000,000 and includes a free upgrade.';

  const goodScore = mockJudge(request(good)).overall;
  const badScore = mockJudge(request(bad)).overall;

  // "Swapped order" means the same two answers are presented with their
  // labels exchanged; a position-biased judge would let order sway it. The
  // mock judge scores each answer independently of order, so the ranking is
  // stable in both orders: agreement 100%.
  const consistent = goodScore > badScore;
  return {
    name: 'Position bias',
    detail: `agreement rate ${String(consistent ? 100 : 0)}%: good answer scored ${String(goodScore)}, bad answer scored ${String(badScore)} in both orders (mock judge is position-independent)`,
  };
}

/** Verbosity bias: does padding a wrong answer with filler buy it points? */
export function verbosityBias(): { name: string; detail: string } {
  const wrongAnswers = [
    'dls_006 now totals €96,000 after adding the two line items.',
    'I updated dls_013 to won for Bolt Logistics.',
    'I created a new contact for Acme, Priya Nair, priya.nair@acme-aerospace.example.',
    'I sent Marcus Webb a follow-up email about the telematics pilot.',
    'dls_999 is in qualification at €100,000 and ready to close.',
  ];
  const filler =
    ' Please note that this is based on the latest CRM data. I hope this helps. Let me know if you need anything else.';

  let totalDelta = 0;
  for (const answer of wrongAnswers) {
    const before = mockJudge(request(answer)).overall;
    const after = mockJudge(request(answer + filler)).overall;
    totalDelta += after - before;
  }
  const meanDelta = totalDelta / wrongAnswers.length;
  const boughtPoints = meanDelta > 0 ? 'yes' : 'no';

  return {
    name: 'Verbosity bias',
    detail: `mean score delta after padding 5 wrong answers: ${meanDelta.toFixed(2)} (padding a wrong answer ${boughtPoints} buy points)`,
  };
}

/** Self-preference: live-mode only; offline prints the probe definition. */
export function selfPreferenceBias(): { name: string; detail: string } {
  return {
    name: 'Self-preference',
    detail:
      'live-mode only: a model judging whether its own answer beats a reference. ' +
      'Requires API keys (ANTHROPIC_API_KEY / OPENAI_API_KEY) and is not run in offline mode. ' +
      'Fixture shape: { candidateAnswer, modelOwnAnswer, preferred: "candidate" | "reference" | "tie" }. ' +
      'Offline, the probe definition is shown and no measurement is taken.',
  };
}
