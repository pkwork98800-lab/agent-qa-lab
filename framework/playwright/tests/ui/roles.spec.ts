import { test, expect } from '../../fixtures.ts';
import { RoleSwitcherPage } from '../../pages/RoleSwitcherPage.ts';
import { RecordsPage } from '../../pages/RecordsPage.ts';
import { CreateContactPage } from '../../pages/CreateContactPage.ts';

const ROLES = [
  { userId: 'usr_emma', role: 'owner', name: 'Emma' },
  { userId: 'usr_viktor', role: 'admin', name: 'Viktor' },
  { userId: 'usr_liam', role: 'sales_rep', name: 'Liam' },
  { userId: 'usr_sofia', role: 'support_agent', name: 'Sofia' },
  { userId: 'usr_raul', role: 'read_only', name: 'Raul' },
  { userId: 'usr_dana', role: 'external', name: 'Dana' },
] as const;

test.describe('UI role visibility', () => {
  for (const { userId, role, name } of ROLES) {
    test(`as ${role} (${name}), the UI shows role-appropriate records and controls`, async ({
      page,
      resetDb,
    }) => {
      await resetDb();
      const switcher = new RoleSwitcherPage(page);
      const records = new RecordsPage(page);
      const create = new CreateContactPage(page);

      await switcher.goto(userId);
      await switcher.selectActor(userId);

      await expect(page.getByText(new RegExp(`${userId} \\(${role}\\)`))).toBeVisible();

      await records.goto('contact', userId);
      const contactCount = await records.rowCount();
      expect(contactCount).toBeGreaterThan(0);

      if (role === 'external') {
        const ids = (await records.rows()).map((r) => r.id);
        expect(ids).toContain('con_008');
        expect(ids).toContain('con_009');
        expect(ids.filter((id) => id.startsWith('con_')).length).toBe(2);
      }

      // BUILD-CONTRACT §3: only owner / admin / sales_rep may create contacts.
      // support_agent, read_only and external see the "may not create contacts" panel instead.
      if (role === 'support_agent' || role === 'read_only' || role === 'external') {
        expect(await create.isFormVisible()).toBe(false);
        expect(await create.deniedMessage()).toContain('may not create contacts');
      } else {
        expect(await create.isFormVisible()).toBe(true);
      }
    });
  }

  test('read_only sees no create button and cannot create via the UI', async ({
    page,
    resetDb,
  }) => {
    await resetDb();
    const switcher = new RoleSwitcherPage(page);
    const create = new CreateContactPage(page);

    await switcher.goto('usr_raul');
    await switcher.selectActor('usr_raul');
    await create.goto('usr_raul');

    expect(await create.isFormVisible()).toBe(false);
    expect(await create.deniedMessage()).toContain('may not create contacts');
  });
});
