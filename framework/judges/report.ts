/**
 * `generateJudgeCalibrationResult` → `reports/judge-calibration.md`.
 * ---------------------------------------------------------------------------
 * Renders the calibration result (confusion matrix, accuracy, precision /
 * recall on `fail`, Cohen's kappa with plain-English interpretation, per-dimension
 * breakdown, cost per 1,000 judgements, bias probes) into a single markdown
 * report. No wall-clock timestamps: the same input regenerates byte-identically.
 */
import type { CalibrationResult } from './index.ts';
import { rubricFor, rubricAnchorMarkdown } from './rubrics.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ReportOptions {
  result: CalibrationResult;
  judgedEntries: Array<{
    scenarioId: string;
    human?: string;
    verdict: { overall: number; passed: boolean; rationale: string };
  }>;
}

function pct(value: number): string {
  return (value * 100).toFixed(1) + '%';
}

function matrixRow(label: string, row: number[]): string {
  return `| ${label.padEnd(10)} | ${row.join(' | ')} |`;
}

export function generateJudgeCalibrationReport(
  result: CalibrationResult,
  outPath: string,
  _judgedEntries: ReportOptions['judgedEntries'] = [],
): void {
  const rubric = rubricFor(result.rubricId);
  const { confusion } = result;
  const [passRow, failRow] = confusion.matrix;

  const lines: string[] = [];
  lines.push('# Judge calibration report');
  lines.push('');
  lines.push(
    `Rubric: ${rubric.name} (${result.rubricId}) — pass threshold ≥ ${String(rubric.passThreshold)}`,
  );
  lines.push(`Total golden answers scored: ${String(result.totalAnswers)}`);
  lines.push(`Labelled pairs (human + judge): ${String(result.labelledPairs)}`);
  lines.push('');
  lines.push('> Pilot: human labels cover 12 of 60 answers. The headline figures below are ');
  lines.push('> measured against this pilot set and are **not** the final headline. The full ');
  lines.push('> 60-entry human labelling pass is performed by the repo author and replaces ');
  lines.push(
    '> `framework/judges/golden-set/human-labels.jsonl` before the headline kappa is quoted.',
  );
  lines.push('');

  // ------------------------------------------------------------------
  // Headline table
  // ------------------------------------------------------------------
  lines.push('## Headline');
  lines.push('');
  lines.push('| metric | value |');
  lines.push('|---|---|');
  lines.push(`| accuracy (pilot) | ${pct(result.accuracy)} |`);
  lines.push(`| precision on fail | ${pct(result.precisionOnFail)} |`);
  lines.push(`| recall on fail | ${pct(result.recallOnFail)} |`);
  lines.push(`| Cohen's kappa (pilot) | ${result.cohenKappa.toFixed(3)} |`);
  lines.push(`| kappa interpretation | ${result.kappaInterpretation} |`);
  lines.push(`| cost per 1,000 judgements (mock) | $${result.costPer1000Usd.toFixed(4)} real |`);
  lines.push('');

  // ------------------------------------------------------------------
  // Confusion matrix
  // ------------------------------------------------------------------
  lines.push('## Confusion matrix (rows = human, cols = judge)');
  lines.push('');
  lines.push(`| | ${confusion.classes.map((c) => `judge:${c}`).join(' | ')} |`);
  lines.push(`|---|${confusion.classes.map(() => '---').join('|')}|`);
  lines.push(matrixRow(`human:pass`, passRow));
  lines.push(matrixRow(`human:fail`, failRow));
  lines.push('');
  lines.push(
    `Support — human pass: ${String(passRow[0] + passRow[1])}, human fail: ${String(failRow[0] + failRow[1])}.`,
  );
  lines.push('');

  // ------------------------------------------------------------------
  // Per-dimension breakdown
  // ------------------------------------------------------------------
  lines.push('## Per-dimension breakdown (mock judge, all scored answers)');
  lines.push('');
  for (const dim of result.perDimension) {
    lines.push(
      `- ${dim.name}: mean ${dim.meanScore.toFixed(2)}, min ${String(dim.minScore)}, max ${String(dim.maxScore)}`,
    );
  }
  lines.push('');

  // ------------------------------------------------------------------
  // Rubric anchors
  // ------------------------------------------------------------------
  lines.push('## Rubric anchors');
  lines.push('');
  lines.push(rubricAnchorMarkdown(rubric));
  lines.push('');

  // ------------------------------------------------------------------
  // Bias probes
  // ------------------------------------------------------------------
  lines.push('## Bias probes');
  lines.push('');
  for (const probe of result.biasProbes) {
    lines.push(`- ${probe.name}: ${probe.detail}`);
  }
  lines.push('');

  // ------------------------------------------------------------------
  // Known limits
  // ------------------------------------------------------------------
  lines.push('## Known limits');
  lines.push('');
  lines.push(
    '- The headline kappa is measured against the author pilot labels (12 entries), not the full 60.',
  );
  lines.push(
    '- Claude / OpenAI judges are implemented and fixture-shaped but not measured without API keys.',
  );
  lines.push(
    '- Offline mode uses the mock judge at $0 real cost; live mode is opt-in and cost-capped.',
  );
  lines.push('');

  const body = lines.join('\n') + '\n';
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, body, 'utf8');
}
