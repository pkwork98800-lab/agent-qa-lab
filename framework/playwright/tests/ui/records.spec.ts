import { test, expect } from '../../fixtures.ts';
import { RoleSwitcherPage } from '../../pages/RoleSwitcherPage.ts';
import { RecordsPage } from '../../pages/RecordsPage.ts';
import { RecordDetailPage } from '../../pages/RecordDetailPage.ts';
import { CreateContactPage } from '../../pages/CreateContactPage.ts';

test.describe('Records UI', () => {
  test('lists contacts and searching by name filters results', async ({ page, resetDb }) => {
    await resetDb();
    const switcher = new RoleSwitcherPage(page);
    const records = new RecordsPage(page);

    await switcher.goto('usr_emma');
    await switcher.selectActor('usr_emma');
    await records.goto('contact', 'usr_emma');

    const before = await records.rowCount();
    expect(before).toBeGreaterThan(0);

    await records.search('Priya', 'contact', 'usr_emma');
    const after = await records.rowCount();
    expect(after).toBeLessThan(before);
    // A successful search renders results, not the "No ... match" message.
    expect((await records.emptyMessage()) ?? '').not.toContain('No');

    const ids = (await records.rows()).map((r) => r.id);
    expect(ids).toContain('con_001');
  });

  test('opening a record shows its detail fields', async ({ page, resetDb }) => {
    await resetDb();
    const switcher = new RoleSwitcherPage(page);
    const records = new RecordsPage(page);
    const detail = new RecordDetailPage(page);

    await switcher.goto('usr_emma');
    await switcher.selectActor('usr_emma');
    await records.goto('contact', 'usr_emma');

    await records.openRecord('Priya Nair');
    const identity = await detail.recordIdentity();
    expect(identity).toEqual({ type: 'contact', id: 'con_001' });
    expect(await detail.field('name')).toBe('Priya Nair');
    expect(await detail.field('email')).toBe('priya.nair@acme-aerospace.example');
  });

  test('happy-path create contact as liam', async ({ page, resetDb }) => {
    await resetDb();
    const switcher = new RoleSwitcherPage(page);
    const create = new CreateContactPage(page);
    const records = new RecordsPage(page);

    await switcher.goto('usr_liam');
    await switcher.selectActor('usr_liam');
    await create.goto('usr_liam');

    expect(await create.isFormVisible()).toBe(true);
    await create.create(
      'New Contact',
      'cmp_acme',
      'new.contact@acme-aerospace.example',
      '+44 20 7946 0050',
      'Buyer',
    );

    await expect(page.getByText(/Created contact/)).toBeVisible({ timeout: 5000 });
    await records.goto('contact', 'usr_liam');
    const ids = (await records.rows()).map((r) => r.id);
    expect(ids.some((id) => id.startsWith('con_') && id > 'con_010')).toBe(true);
  });

  test('denied create contact as raul shows the server 403 message', async ({ page, resetDb }) => {
    await resetDb();
    const switcher = new RoleSwitcherPage(page);
    const create = new CreateContactPage(page);

    await switcher.goto('usr_raul');
    await switcher.selectActor('usr_raul');
    await create.goto('usr_raul');

    expect(await create.isFormVisible()).toBe(false);
    const message = await create.deniedMessage();
    expect(message).toBeTruthy();
    expect(message).toContain('may not create contacts');
  });
});
