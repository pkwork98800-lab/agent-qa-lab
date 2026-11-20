/**
 * assertDbConsistent — deterministic promptfoo assertion.
 *
 * Verifies the deal-total-matches-line-items invariant by calling the app's
 * snapshot endpoint and recomputing. Falls back to `metadata.dbDiff` if
 * the provider populated it.
 *
 * Signature: (output, { vars, provider }) => { pass, score, reason }
 *   vars.dealId: the deal id to check (required)
 */
export default function assertDbConsistent(output, { vars, provider }) {
  const dealId = vars.dealId;
  if (!dealId) {
    return { pass: false, score: 0, reason: 'vars.dealId is required for assertDbConsistent.' };
  }

  // Prefer provider-populated dbDiff when available.
  const dbDiff = output.metadata && output.metadata.dbDiff;
  if (dbDiff) {
    const lineItems = (dbDiff.tables && dbDiff.tables.line_items) || [];
    const dealRows = (dbDiff.tables && dbDiff.tables.deals) || [];
    const deal = dealRows.find((r) => r.id === dealId);
    if (!deal) {
      return { pass: false, score: 0, reason: `Deal ${dealId} not found in db_after.` };
    }
    const itemsForDeal = lineItems.filter((r) => r.dealId === dealId);
    const sum = itemsForDeal.reduce((acc, r) => acc + (r.totalCents || 0), 0);
    if (sum !== (deal.amountCents || 0)) {
      return {
        pass: false,
        score: 0,
        reason: `Deal ${dealId}: amountCents ${deal.amountCents} != line items sum ${sum}`,
      };
    }
    return { pass: true, score: 1, reason: `Deal ${dealId} total consistent (sum=${sum}).` };
  }

  // Fallback: query the app's line-items endpoint and deals endpoint.
  const baseUrl = process.env.APP_BASE_URL ?? 'http://127.0.0.1:4799';
  return (async () => {
    try {
      const [dealResp, itemsResp] = await Promise.all([
        fetch(`${baseUrl}/api/v1/records/deal/${dealId}`),
        fetch(`${baseUrl}/api/v1/deals/${dealId}/line-items`),
      ]);
      const deal = await dealResp.json();
      const items = await itemsResp.json();
      const sum = (items.items || []).reduce((acc, r) => acc + (r.totalCents || 0), 0);
      if (sum !== (deal.amountCents || 0)) {
        return {
          pass: false,
          score: 0,
          reason: `Deal ${dealId}: amountCents ${deal.amountCents} != line items sum ${sum}`,
        };
      }
      return { pass: true, score: 1, reason: `Deal ${dealId} total consistent (sum=${sum}).` };
    } catch (err) {
      return {
        pass: false,
        score: 0,
        reason: `Failed to verify DB consistency for ${dealId}: ${err.message}`,
      };
    }
  })();
}
