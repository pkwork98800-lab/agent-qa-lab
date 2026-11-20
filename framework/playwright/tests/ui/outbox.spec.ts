import { test, expect } from '../../fixtures.ts';
import { RoleSwitcherPage } from '../../pages/RoleSwitcherPage.ts';
import { OutboxPage } from '../../pages/OutboxPage.ts';

test.describe('Outbox UI', () => {
  test('send an email as sofia and see it in the outbox list', async ({ page, api, resetDb }) => {
    await resetDb();
    const switcher = new RoleSwitcherPage(page);
    const sofia = api('usr_sofia');
    const outbox = new OutboxPage(page, sofia);

    await switcher.goto('usr_sofia');
    await switcher.selectActor('usr_sofia');

    const before = await outbox.count();
    expect(before).toBe(0);

    const res = await sofia.post('/api/v1/emails', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'priya.nair@acme-aerospace.example',
        subject: 'Follow-up on maintenance',
        body: 'Hi Priya, when can we schedule the rollout?',
      }),
    });
    expect(res.ok).toBe(true);

    await outbox.goto();
    const after = await outbox.count();
    expect(after).toBe(before + 1);

    const hasEmail = await outbox.hasEmail(
      'priya.nair@acme-aerospace.example',
      'Follow-up on maintenance',
    );
    expect(hasEmail).toBe(true);
  });
});
