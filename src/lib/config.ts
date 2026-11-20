import { fileURLToPath } from 'node:url';
import type { Suite } from '../contracts/types.ts';

/**
 * Repo root resolved from this file's own URL — never a hardcoded absolute
 * path, so the repo works from any checkout location on any OS.
 */
export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Eval-runner app port (BUILD-CONTRACT §4). */
export const APP_PORT = 4799;

/** Playwright webServer port (BUILD-CONTRACT §4). */
export const PLAYWRIGHT_APP_PORT = 4731;

/** Suites are directories of scenarios; `golden` holds the judges' labels. */
export const SUITES: Record<Suite, { dir: string; description: string }> = {
  smoke: {
    dir: 'scenarios/smoke',
    description: 'The cheap CI subset: every scenario offline, under a minute.',
  },
  core: {
    dir: 'scenarios/core',
    description: 'The full realistic suite covering every frozen tool and permission row.',
  },
  redteam: {
    dir: 'scenarios/redteam',
    description: 'Adversarial probes: hallucination, injection, cross-tenant, exfiltration.',
  },
  golden: {
    dir: 'framework/judges/golden-set',
    description: 'Hand-labelled scenarios that measure the judges themselves.',
  },
};

/** The four latent bug flags in apps/under-test (docs/ARCHITECTURE.md). */
export const BUG_FLAGS: readonly string[] = [
  'BUG_STALE_ROLE_CACHE',
  'BUG_PARTIAL_LINE_ITEM_WRITE',
  'BUG_UNLOGGED_TOOL_SPAN',
  'BUG_HALLUCINATED_FALLBACK',
];

/** List price per 1M tokens, USD, used only for live-mode cost estimates. */
export interface ModelPrice {
  readonly inputUsdPerMTok: number;
  readonly outputUsdPerMTok: number;
}

/**
 * List prices as published by each provider. Estimates only: no pricing API is
 * called, so a live run's metered cost can drift from these figures. Models
 * missing from this table estimate as $0 (see estimateCostUsd).
 */
export const PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-sonnet-4-5': { inputUsdPerMTok: 3, outputUsdPerMTok: 15 },
  'claude-haiku-4-5': { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
  'gpt-4o-mini': { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6 },
  'gpt-4o': { inputUsdPerMTok: 2.5, outputUsdPerMTok: 10 },
};

/** The transcript CSV columns, in order (BUILD-CONTRACT §8). */
export const CSV_COLUMNS: readonly string[] = [
  'scenario_id',
  'persona',
  'suite',
  'turns',
  'full_transcript',
  'tools_called',
  'db_before',
  'db_after',
  'verdict',
  'judge_score',
  'judge_rationale',
  'cost_usd',
  'latency_ms',
  'trace_url',
];
