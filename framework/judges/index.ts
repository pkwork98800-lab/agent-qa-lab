/**
 * Judges + calibration kit (agent 5).
 * ---------------------------------------------------------------------------
 * Frozen surface (docs/BUILD-CONTRACT.md §7):
 *   getJudge(id)        -> 'mock' | 'claude' | 'openai'
 *   computeKappa(a, b)  -> Cohen's kappa over two label sequences
 *   confusionMatrix(...) -> rows=human, cols=judge, classes ['pass','fail']
 *   calibrate(opts)     -> run mock judge over golden answers vs human labels,
 *                          write reports/judge-calibration.md
 *
 * Three judges behind one `Judge` interface:
 *   - mock   : deterministic, grounded in toolsCalled/dbDiff, $0, no keys.
 *   - claude : Anthropic Messages API, live, requires ANTHROPIC_API_KEY.
 *   - openai : OpenAI Chat Completions, live, requires OPENAI_API_KEY.
 *
 * Live judges use content-hash caching (cache.ts) so re-runs are free, and
 * requireLiveKey so they fail loudly without keys rather than faking verdicts.
 */
import type {
  DbDiff,
  ExpectedOutcome,
  GoldenLabel,
  JudgeRequest,
  JudgeVerdict,
  JudgeMode,
  PersonaId,
  ToolCallRecord,
} from '../../src/contracts/types.ts';
import { createMockJudge } from './mock-judge.ts';
import { rubricFor, buildJudgePrompt } from './rubrics.ts';
import { JudgeCache, cacheKey } from './cache.ts';
import { existsSync, readFileSync } from 'node:fs';
import { loadEnv, requireLiveKey } from '../../src/lib/env.ts';
import { estimateCostUsd } from '../../src/lib/cost.ts';
import { generateJudgeCalibrationReport } from './report.ts';
import { positionBias, verbosityBias, selfPreferenceBias } from './bias-probes.ts';

// ---------------------------------------------------------------------------
// Judge interface

export interface Judge {
  readonly id: string;
  readonly mode: JudgeMode;
  judge(req: JudgeRequest): Promise<JudgeVerdict>;
}

export interface GetJudgeOptions {
  /** Persisted cache file for live judges. Defaults to runs/latest/judge-cache.json. */
  cachePath?: string;
}

const DEFAULT_CACHE_PATH = 'runs/latest/judge-cache.json';

/** Return a judge by id. `mock` always works; `claude`/`openai` throw without keys. */
export function getJudge(id: string, opts: GetJudgeOptions = {}): Judge {
  const cachePath = opts.cachePath ?? DEFAULT_CACHE_PATH;
  switch (id) {
    case 'mock':
      return createMockJudge();
    case 'claude':
      return new ClaudeJudge({ cachePath });
    case 'openai':
      return new OpenAIJudge({ cachePath });
    default:
      throw new Error(`unknown judge id "${id}"; expected one of: mock, claude, openai`);
  }
}

// ---------------------------------------------------------------------------
// Calibration result type (module-specific; not in the frozen contracts)

export interface PerDimensionBreakdown {
  name: string;
  meanScore: number;
  minScore: number;
  maxScore: number;
}

export interface BiasProbeResult {
  name: string;
  detail: string;
}

export interface CalibrationResult {
  rubricId: string;
  totalAnswers: number;
  labelledPairs: number;
  confusion: { classes: string[]; matrix: number[][] };
  accuracy: number;
  precisionOnFail: number;
  recallOnFail: number;
  cohenKappa: number;
  kappaInterpretation: string;
  perDimension: PerDimensionBreakdown[];
  costPer1000Usd: number;
  biasProbes: BiasProbeResult[];
}

/** Cohen's kappa for two label sequences over the same items, pure TS. */
export function computeKappa(a: string[], b: string[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let agree = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) agree += 1;
  }
  const po = agree / a.length;

  const classes = [...new Set([...a, ...b])];
  let pe = 0;
  for (const cls of classes) {
    const pa = a.filter((x) => x === cls).length / a.length;
    const pb = b.filter((x) => x === cls).length / b.length;
    pe += pa * pb;
  }

  const denom = 1 - pe;
  if (denom === 0) return po === 1 ? 1 : 0;
  return (po - pe) / denom;
}

/** Confusion matrix: rows = human labels, cols = judge predictions. */
export function confusionMatrix(
  labels: string[],
  preds: string[],
  classes: string[],
): { classes: string[]; matrix: number[][] } {
  const matrix = classes.map(() => classes.map(() => 0));
  const index = Object.fromEntries(classes.map((c, i) => [c, i]));
  for (let i = 0; i < labels.length; i += 1) {
    const row = index[labels[i]];
    const col = index[preds[i]];
    matrix[row][col] += 1;
  }
  return { classes, matrix };
}

/** Precision / recall treating `fail` as the positive class. */
function failPrecisionRecall(
  human: string[],
  pred: string[],
): { precision: number; recall: number; support: number } {
  let tp = 0;
  let predFail = 0;
  let humanFail = 0;
  for (let i = 0; i < human.length; i += 1) {
    if (pred[i] === 'fail') predFail += 1;
    if (human[i] === 'fail') humanFail += 1;
    if (human[i] === 'fail' && pred[i] === 'fail') tp += 1;
  }
  const precision = predFail === 0 ? 0 : tp / predFail;
  const recall = humanFail === 0 ? 0 : tp / humanFail;
  return { precision, recall, support: humanFail };
}

function kappaInterpretation(kappa: number): string {
  if (kappa < 0) return 'worse than chance';
  if (kappa < 0.2) return 'slight agreement';
  if (kappa < 0.4) return 'fair agreement';
  if (kappa < 0.6) return 'moderate agreement';
  if (kappa < 0.8) return 'substantial agreement';
  return 'almost perfect agreement';
}

// ---------------------------------------------------------------------------
// Live judges (Claude / OpenAI)

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

interface JsonVerdictPayload {
  scores: Record<string, number>;
  overall: number;
  passed: boolean;
  rationale: string;
}

function parseJsonVerdict(text: string): JsonVerdictPayload {
  let cleaned = text.trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  const parsed = JSON.parse(cleaned) as JsonVerdictPayload;
  const overall = Number.isFinite(parsed.overall)
    ? Math.min(5, Math.max(1, Math.round(parsed.overall)))
    : 1;
  return {
    scores: parsed.scores,
    overall,
    passed: parsed.passed,
    rationale: parsed.rationale,
  };
}

abstract class BaseLiveJudge implements Judge {
  abstract readonly id: string;
  abstract readonly model: string;
  abstract readonly providerKey: 'anthropic' | 'openai';
  abstract callApi(
    system: string,
    user: string,
  ): Promise<{ text: string; promptTokens: number; completionTokens: number }>;

  readonly mode = 'live' as const;
  private cache: JudgeCache;

  constructor({ cachePath }: { cachePath: string }) {
    this.cache = new JudgeCache(cachePath);
    this.cache.load();
  }

  async judge(req: JudgeRequest): Promise<JudgeVerdict> {
    const env = loadEnv();
    requireLiveKey(env, this.providerKey);

    const rubric = rubricFor(req.rubricId);
    const key = cacheKey({
      scenarioId: req.scenarioId,
      answer: req.answer,
      rubricId: req.rubricId,
      model: this.model,
    });

    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const system = buildJudgePrompt({
      id: rubric.id,
      name: rubric.name,
      description: rubric.description,
      dimensions: rubric.dimensions,
      passThreshold: rubric.passThreshold,
    });
    const user = [
      `Scenario: ${req.scenarioId}`,
      `Persona: ${req.persona}`,
      `Question: ${req.question}`,
      `Expected outcome: ${req.expectedOutcome.description}`,
      `Key facts: ${req.expectedOutcome.keyFacts.join('; ')}`,
      `Answer to judge:\n${req.answer}`,
      '',
      'Return only the JSON verdict object.',
    ].join('\n');

    const { text, promptTokens, completionTokens } = await this.callApi(system, user);
    const verdictPayload = parseJsonVerdict(text);
    const passed = verdictPayload.overall >= rubric.passThreshold;

    const costUsd = estimateCostUsd(this.model, promptTokens, completionTokens);
    const verdict: JudgeVerdict = {
      judgeId: this.id,
      model: this.model,
      mode: 'live',
      scores: verdictPayload.scores,
      overall: verdictPayload.overall,
      passed,
      rationale: verdictPayload.rationale,
      cached: false,
      costUsd,
      latencyMs: 0,
    };

    this.cache.set(key, verdict);
    this.cache.save();
    return verdict;
  }
}

export class ClaudeJudge extends BaseLiveJudge {
  readonly id = 'claude';
  readonly model = 'claude-sonnet-4-5';
  readonly providerKey = 'anthropic' as const;

  async callApi(system: string, user: string) {
    const env = loadEnv();
    const key = requireLiveKey(env, 'anthropic');
    let text = '';
    let attempt = 0;
    const maxAttempts = 2;
    let lastError: unknown = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 512,
            system,
            temperature: 0,
            messages: [{ role: 'user', content: user }],
          }),
        });
        if (!response.ok) {
          throw new Error(`Anthropic API HTTP ${String(response.status)}`);
        }
        const body = (await response.json()) as {
          content: Array<{ type: string; text?: string }>;
        };
        text = body.content.map((c) => c.text ?? '').join('');
        break;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          await sleep(200 * attempt);
        }
      }
    }
    if (text === '') {
      throw new Error(
        lastError instanceof Error
          ? lastError.message
          : `Anthropic returned no text (${JSON.stringify(lastError ?? 'unknown error')})`,
      );
    }
    return {
      text,
      promptTokens: estimateTokens(system + user),
      completionTokens: estimateTokens(text),
    };
  }
}

export class OpenAIJudge extends BaseLiveJudge {
  readonly id = 'openai';
  readonly model = 'gpt-4o-mini';
  readonly providerKey = 'openai' as const;

  async callApi(system: string, user: string) {
    const env = loadEnv();
    const key = requireLiveKey(env, 'openai');
    let text = '';
    let attempt = 0;
    const maxAttempts = 2;
    let lastError: unknown = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        });
        if (!response.ok) {
          throw new Error(`OpenAI API HTTP ${String(response.status)}`);
        }
        const body = (await response.json()) as {
          choices: Array<{ message: { content?: string } }>;
        };
        text = body.choices[0]?.message?.content ?? '';
        break;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          await sleep(200 * attempt);
        }
      }
    }
    if (text === '') {
      throw new Error(
        lastError instanceof Error
          ? lastError.message
          : `OpenAI returned no text (${JSON.stringify(lastError ?? 'unknown error')})`,
      );
    }
    return {
      text,
      promptTokens: estimateTokens(system + user),
      completionTokens: estimateTokens(text),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// calibrate()

export interface CalibrateOptions {
  goldenPath: string;
  humanLabels?: string;
  outPath: string;
  rubricId?: string;
}

/**
 * Load golden answers + human labels, run the mock judge over every labelled
 * answer, and write the calibration report. Only answers with a human label
 * contribute to accuracy/kappa; the rest are scored for the per-dimension
 * breakdown and cost estimate.
 */
export async function calibrate(opts: CalibrateOptions): Promise<CalibrationResult> {
  const {
    goldenPath,
    humanLabels = defaultHumanLabelsPath(goldenPath),
    outPath,
    rubricId = 'core-quality',
  } = opts;

  const answers = readNdjson<GoldenAnswerEntry>(goldenPath);
  const labelsByScenario = readHumanLabels(humanLabels);

  const judge = getJudge('mock');
  const humanVerdicts: string[] = [];
  const judgeVerdicts: string[] = [];
  const judgedEntries: Array<{ scenarioId: string; verdict: JudgeVerdict }> = [];

  for (const entry of answers) {
    const req: JudgeRequest = {
      scenarioId: entry.scenarioId,
      persona: entry.persona as PersonaId,
      question: entry.question,
      answer: entry.answer,
      expectedOutcome: entry.expectedOutcome,
      rubricId,
      grounding: entry.grounding,
    };
    const verdict = await judge.judge(req);
    judgedEntries.push({ scenarioId: entry.scenarioId, verdict });
    if (entry.scenarioId in labelsByScenario) {
      const human = labelsByScenario[entry.scenarioId];
      humanVerdicts.push(human);
      judgeVerdicts.push(verdict.passed ? 'pass' : 'fail');
    }
  }

  const confusion = confusionMatrix(humanVerdicts, judgeVerdicts, ['pass', 'fail']);
  const pr = failPrecisionRecall(humanVerdicts, judgeVerdicts);
  const kappa = computeKappa(humanVerdicts, judgeVerdicts);
  const accuracy =
    humanVerdicts.length === 0
      ? 0
      : humanVerdicts.filter((h, i) => h === judgeVerdicts[i]).length / humanVerdicts.length;

  const perDimension = perDimensionBreakdown(judgedEntries);
  const totalCost = judgedEntries.reduce((sum, e) => sum + e.verdict.costUsd, 0);
  const costPer1000 = judgedEntries.length === 0 ? 0 : (totalCost / judgedEntries.length) * 1000;

  const biasProbes = [positionBias(), verbosityBias(), selfPreferenceBias()];

  const result: CalibrationResult = {
    rubricId,
    totalAnswers: answers.length,
    labelledPairs: humanVerdicts.length,
    confusion,
    accuracy,
    precisionOnFail: pr.precision,
    recallOnFail: pr.recall,
    cohenKappa: kappa,
    kappaInterpretation: kappaInterpretation(kappa),
    perDimension,
    costPer1000Usd: costPer1000,
    biasProbes,
  };

  generateJudgeCalibrationReport(result, outPath, judgedEntries);
  return result;
}

interface GoldenAnswerEntry {
  scenarioId: string;
  persona: string;
  question: string;
  answer: string;
  expectedOutcome: ExpectedOutcome;
  grounding: { toolsCalled: ToolCallRecord[]; dbDiff?: DbDiff };
}

function defaultHumanLabelsPath(goldenPath: string): string {
  const slash = goldenPath.lastIndexOf('/');
  const dir = slash === -1 ? '.' : goldenPath.slice(0, slash);
  return `${dir}/human-labels.jsonl`;
}

function readNdjson<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8').trimEnd();
  if (text.length === 0) return [];
  return text.split('\n').map((line) => JSON.parse(line.trim()) as T);
}

function readHumanLabels(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readNdjson<GoldenLabel & { scenarioId: string }>(path)) {
    if (entry.scenarioId) {
      out[entry.scenarioId] = entry.humanVerdict;
    }
  }
  return out;
}

function perDimensionBreakdown(
  entries: Array<{ scenarioId: string; verdict: JudgeVerdict; human?: string }>,
): PerDimensionBreakdown[] {
  const dims: string[] = ['groundedness', 'task-completeness', 'tone-policy', 'safety'];
  return dims.map((name) => {
    const scores = entries
      .map((e) => e.verdict.scores[name])
      .filter((s): s is number => typeof s === 'number');
    if (scores.length === 0) {
      return { name, meanScore: 0, minScore: 0, maxScore: 0 };
    }
    return {
      name,
      meanScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      minScore: Math.min(...scores),
      maxScore: Math.max(...scores),
    };
  });
}
