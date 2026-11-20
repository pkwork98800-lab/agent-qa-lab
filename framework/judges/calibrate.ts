/**
 * CLI entry for the judge calibration kit.
 * ---------------------------------------------------------------------------
 * Runs the mock judge over the golden answers, compares against the human
 * pilot labels, and writes `reports/judge-calibration.md`.
 *
 *   npx tsx framework/judges/calibrate.ts
 *
 * Options:
 *   --golden   path to golden-answers.jsonl  (default: framework/judges/golden-set/golden-answers.jsonl)
 *   --labels   path to human-labels.jsonl    (default: framework/judges/golden-set/human-labels.jsonl)
 *   --out      report output path            (default: reports/judge-calibration.md)
 *   --rubric   rubric id                     (default: core-quality)
 */
import { calibrate, computeKappa, confusionMatrix } from './index.ts';

const DEFAULT_GOLDEN = 'framework/judges/golden-set/golden-answers.jsonl';
const DEFAULT_LABELS = 'framework/judges/golden-set/human-labels.jsonl';
const DEFAULT_OUT = 'reports/judge-calibration.md';

function parseArgs(argv: string[]): {
  golden: string;
  labels: string;
  out: string;
  rubric: string;
} {
  let golden = DEFAULT_GOLDEN;
  let labels = DEFAULT_LABELS;
  let out = DEFAULT_OUT;
  let rubric = 'core-quality';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--golden' && next) {
      golden = next;
      i += 1;
      continue;
    }
    if (arg === '--labels' && next) {
      labels = next;
      i += 1;
      continue;
    }
    if (arg === '--out' && next) {
      out = next;
      i += 1;
      continue;
    }
    if (arg === '--rubric' && next) {
      rubric = next;
      i += 1;
      continue;
    }
  }
  return { golden, labels, out, rubric };
}

function kappaSanity(): string {
  const perfect = computeKappa(['pass', 'fail', 'pass'], ['pass', 'fail', 'pass']);
  const skewed = computeKappa(
    ['pass', 'pass', 'pass', 'pass', 'fail'],
    ['pass', 'pass', 'pass', 'fail', 'fail'],
  );
  const matrix = confusionMatrix(
    ['pass', 'fail', 'fail', 'pass'],
    ['pass', 'pass', 'fail', 'pass'],
    ['pass', 'fail'],
  );
  return [
    'computeKappa sanity:',
    `  perfect agreement -> ${perfect.toFixed(3)} (expect 1.000)`,
    `  skewed-set partial agreement -> ${skewed.toFixed(3)} (expect ~0.000)`,
    `  confusionMatrix shape -> classes ${matrix.classes.join(',')}, matrix ${matrix.matrix.map((r) => r.join(',')).join('; ')}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const { golden, labels, out, rubric } = parseArgs(process.argv.slice(2));

  console.log(`Judging golden set: ${golden}`);
  console.log(`Human labels:       ${labels}`);
  console.log(`Report out:         ${out}`);
  console.log(`Rubric:             ${rubric}`);
  console.log('');

  const result = await calibrate({
    goldenPath: golden,
    humanLabels: labels,
    outPath: out,
    rubricId: rubric,
  });

  console.log('');
  console.log('## Headline');
  console.log(`  accuracy (pilot):       ${(result.accuracy * 100).toFixed(1)}%`);
  console.log(`  precision on fail:      ${(result.precisionOnFail * 100).toFixed(1)}%`);
  console.log(`  recall on fail:         ${(result.recallOnFail * 100).toFixed(1)}%`);
  console.log(
    `  Cohen's kappa (pilot):  ${result.cohenKappa.toFixed(3)} — ${result.kappaInterpretation}`,
  );
  console.log(`  cost per 1,000 (mock):  $${result.costPer1000Usd.toFixed(4)} real`);
  console.log(
    `  labelled pairs:         ${String(result.labelledPairs)} / ${String(result.totalAnswers)}`,
  );
  console.log('');
  console.log('## Confusion matrix (rows=human, cols=judge)');
  console.log(`  classes: ${result.confusion.classes.join(', ')}`);
  for (let r = 0; r < result.confusion.matrix.length; r += 1) {
    console.log(`  ${result.confusion.classes[r]}: ${result.confusion.matrix[r].join(' ')}`);
  }
  console.log('');
  console.log('## Bias probes');
  for (const probe of result.biasProbes) {
    console.log(`  - ${probe.name}: ${probe.detail}`);
  }
  console.log('');
  console.log(kappaSanity());
  console.log('');
  console.log(`Wrote ${out}`);
}

void main();
