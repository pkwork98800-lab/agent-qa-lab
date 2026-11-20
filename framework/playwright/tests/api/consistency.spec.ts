import { test, expect } from '../../fixtures.ts';

/**
 * Consistency: append 2 line items to dls_006 as liam, then assert
 *   deals.amountCents == SUM(line_items.totalCents)
 *
 * With the default bug flags this test FAILS — that is the point.
 * BUG_PARTIAL_LINE_ITEM_WRITE causes the deal total to be recomputed from
 * every requested item while only the first row reaches the database, so the
 * deal total overshoots the line-item sum.
 *
 * To see the test pass, disable the bug before running:
 *   POST /api/v1/admin/bugs  { "BUG_PARTIAL_LINE_ITEM_WRITE": false }
 * or boot the server with BUG_PARTIAL_LINE_ITEM_WRITE=0 in the environment.
 * See apps/under-test/bugs.ts (env flag > bug_flags table > ON by default).
 */
test.describe('Data consistency (BUG_PARTIAL_LINE_ITEM_WRITE)', () => {
  test('deal total equals the sum of its line items after appending 2 items as liam', async ({
    api,
    resetDb,
  }) => {
    await resetDb();
    const liam = api('usr_liam');

    const dealBefore = await liam.get<{ amountCents: number }>('/api/v1/records/deal/dls_006');
    expect(dealBefore.ok).toBe(true);
    const dealJson = await dealBefore.json();
    expect(dealJson.amountCents).toBe(64000);

    const res = await liam.post<{ items: unknown[] }>('/api/v1/deals/dls_006/line-items', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { product: 'Extra support hours', qty: 5, unitCents: 10000 },
          { product: 'Travel expenses', qty: 1, unitCents: 25000 },
        ],
      }),
    });
    expect(res.ok).toBe(true);

    const dealAfter = await liam.get<{ amountCents: number }>('/api/v1/records/deal/dls_006');
    expect(dealAfter.ok).toBe(true);
    const deal = await dealAfter.json();

    const items = await liam.get<{ items: { totalCents: number }[] }>(
      '/api/v1/deals/dls_006/line-items',
    );
    const itemsBody = await items.json();
    const sum = itemsBody.items.reduce(
      (acc: number, item: { totalCents: number }) => acc + item.totalCents,
      0,
    );

    expect(deal.amountCents).toBe(sum);
    expect(itemsBody.items.length).toBeGreaterThanOrEqual(2);
  });
});
