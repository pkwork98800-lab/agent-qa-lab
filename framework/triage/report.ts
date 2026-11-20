import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TriageSummary } from '../../src/contracts/types.ts';
import { renderTicketBody } from './tickets.ts';

/**
 * Writes the triage summary to `reports/triage-summary.md`:
 * headline new/dupes/closed/reopened table, one section per decision with the
 * ticket body rendered, and the dedupe similarity table.
 */
export function generateTriageSummaryMarkdown(
  summary: TriageSummary,
  outPath: string,
): Promise<void> {
  const lines: string[] = [];
  lines.push('# Triage Summary');
  lines.push(``);
  lines.push('## Headline');
  lines.push(``);
  lines.push(`| new | dupes | closed | reopened | blocked |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  lines.push(
    `| ${String(summary.new)} | ${String(summary.duplicates)} | ${String(summary.closed)} | ${String(summary.reopened)} | ${String(summary.blocked)} |`,
  );
  lines.push(``);

  // --- Per-decision sections -----------------------------------------------
  for (const decision of summary.decisions) {
    const c = decision.candidate;
    lines.push(`## ${c.title}`);
    lines.push(``);
    lines.push(`- State: ${decision.state}`);
    if (decision.matchedTicketId) lines.push(`- Matched ticket: ${decision.matchedTicketId}`);
    if (decision.similarity !== undefined)
      lines.push(`- Similarity: ${decision.similarity.toFixed(2)}`);
    lines.push(`- Note: ${decision.note}`);
    lines.push(``);
    lines.push(`### Ticket body`);
    lines.push(``);
    lines.push('```markdown');
    lines.push(renderTicketBody(c));
    lines.push('```');
    lines.push(``);
  }

  // --- Dedupe similarity table --------------------------------------------
  lines.push('## Dedupe similarity table');
  lines.push(``);
  lines.push('| Candidate signature | Matched ticket | Similarity | Decision |');
  lines.push('| --- | --- | --- | --- |');
  for (const decision of summary.decisions) {
    const c = decision.candidate;
    const matched = decision.matchedTicketId ?? '—';
    const score = decision.similarity !== undefined ? decision.similarity.toFixed(2) : '—';
    lines.push(`| ${c.signature} | ${matched} | ${score} | ${decision.state} |`);
  }
  lines.push(``);

  const content = lines.join('\n');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content, 'utf8');
  return Promise.resolve();
}
