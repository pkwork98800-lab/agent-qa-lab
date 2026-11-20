import { PRICES } from './config.ts';

/**
 * Running cost total with a ceiling. Offline runs never meter real spend, so
 * the ceiling is a live-mode guard rail only.
 *
 * The running total is rounded to six decimal places (micro-dollars) on every
 * add, so the accumulated figure is byte-stable across runs and platforms
 * instead of accumulating float noise.
 */
export class CostMeter {
  private total = 0;

  constructor(public readonly ceilingUsd: number) {}

  /** Record usage. Rejects negative or non-finite amounts loudly. */
  add(usd: number): void {
    if (!Number.isFinite(usd) || usd < 0) {
      throw new Error(
        `CostMeter.add expects a finite, non-negative dollar amount, received ${String(usd)}.`,
      );
    }
    this.total = Math.round((this.total + usd) * 1e6) / 1e6;
  }

  get totalUsd(): number {
    return this.total;
  }

  get exceeded(): boolean {
    return this.total > this.ceilingUsd;
  }

  /** Throws a polite, specific error when the ceiling has been passed. */
  assertWithinBudget(): void {
    if (this.exceeded) {
      throw new Error(
        `Run cost $${this.total.toFixed(4)} has passed the $${this.ceilingUsd.toFixed(2)} ceiling. ` +
          'Aborting politely: narrow the run, raise MAX_RUN_COST_USD, or stay in offline mode (the default).',
      );
    }
  }
}

/**
 * Estimate a call's cost from the list-price table. Unknown models estimate
 * $0 — an unpriced model must never fabricate spend, and the report shows the
 * model id so the gap is visible.
 */
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  // The lookup may miss: check the key, then read the entry.
  if (!Object.hasOwn(PRICES, model)) return 0;
  const price = PRICES[model];
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return 0;
  const prompt = Math.max(0, promptTokens);
  const completion = Math.max(0, completionTokens);
  return (
    (prompt / 1_000_000) * price.inputUsdPerMTok + (completion / 1_000_000) * price.outputUsdPerMTok
  );
}
