import type { TicketCandidate } from '../../src/contracts/types.ts';

/**
 * Strict Linear markdown ticket body rendered from a TicketCandidate.
 * Sections: Environment, Severity, Repro, Expected, Actual, Evidence, Labels.
 */
export function renderTicketBody(candidate: TicketCandidate): string {
  const lines: string[] = [];
  lines.push(`## Environment`);
  lines.push(`- Source: ${candidate.source}`);
  lines.push(`- Scenario: ${candidate.scenarioId}`);
  lines.push(`- Severity: ${candidate.severity}`);
  lines.push(``);
  lines.push(`## Severity`);
  lines.push(candidate.severity);
  lines.push(``);
  lines.push(`## Repro`);
  for (const step of candidate.repro) {
    lines.push(`- ${step}`);
  }
  lines.push(``);
  lines.push(`## Expected`);
  lines.push(candidate.expected);
  lines.push(``);
  lines.push(`## Actual`);
  lines.push(candidate.actual);
  lines.push(``);
  lines.push(`## Evidence`);
  if (candidate.evidence.reportPath) {
    lines.push(`- Report: ${candidate.evidence.reportPath}`);
  }
  if (candidate.evidence.assertionIds.length > 0) {
    lines.push(`- Assertion ids: ${candidate.evidence.assertionIds.join(', ')}`);
  }
  if (candidate.evidence.transcriptRow !== undefined) {
    lines.push(`- Transcript row: ${String(candidate.evidence.transcriptRow)}`);
  }
  if (candidate.evidence.traceId) {
    lines.push(`- Trace id: ${candidate.evidence.traceId}`);
  }
  lines.push(`- Cost: $${candidate.costUsd.toFixed(4)}`);
  lines.push(``);
  lines.push(`## Labels`);
  lines.push(candidate.labels.join(', ') || 'none');
  lines.push(``);
  return lines.join('\n');
}

/** Short ticket id derived from the stable signature (for fixture display). */
export function ticketIdFromSignature(signature: string): string {
  const hash = requireHash(signature);
  return `TK-${hash}`;
}

function requireHash(input: string): string {
  // A stable, dependency-free 8-char hex id derived from the signature so the
  // same signature always yields the same ticket id (no wall-clock, no random).
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
