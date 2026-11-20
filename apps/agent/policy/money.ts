/**
 * Money and token-estimate helpers for the mock policy engine.
 * ---------------------------------------------------------------------------
 * Owned by agent 2b (apps/agent/**).
 *
 * Two rules from BUILD-CONTRACT §6 are implemented here:
 *  - amounts are quoted in the `€4,800.00` style, derived from integer cents;
 *  - mock token counts are deterministic `chars/4` estimates, labelled as
 *    estimates wherever they are shown (see spans.ts and the README).
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: '€',
  GBP: '£',
  USD: '$',
};

/** Money is integer cents everywhere; this renders it for humans. */
export function formatMoney(amountCents: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  const negative = amountCents < 0;
  const abs = Math.abs(amountCents);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = negative ? '-' : '';
  return `${sign}${symbol}${grouped}.${fraction.toString().padStart(2, '0')}`;
}

/**
 * Deterministic token estimate: `ceil(chars / 4)`. This is an estimate, never
 * a measured count, and is labelled as such on every span that carries it.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
