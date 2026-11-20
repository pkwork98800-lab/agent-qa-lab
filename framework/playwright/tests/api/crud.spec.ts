import { test, expect } from '../../fixtures.ts';

test.describe('API CRUD', () => {
  test('create, read, patch a contact as liam', async ({ api, resetDb }) => {
    await resetDb();
    const liam = api('usr_liam');

    const created = await liam.post<{ id: string; name: string; companyId: string; email: string }>(
      '/api/v1/records/contact',
      {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Ada Lovelace',
          companyId: 'cmp_acme',
          email: 'ada.lovelace@acme-aerospace.example',
          phone: '+44 20 7946 0055',
          role: 'Engineer',
        }),
      },
    );
    expect(created.ok).toBe(true);
    const createdBody = await created.json();
    expect(createdBody.name).toBe('Ada Lovelace');
    expect(createdBody.companyId).toBe('cmp_acme');
    expect(createdBody.id).toMatch(/^con_\d+$/);

    const contactId = createdBody.id;
    const fetched = await liam.get<{ name: string; email: string }>(
      `/api/v1/records/contact/${contactId}`,
    );
    const fetchedBody = await fetched.json();
    expect(fetchedBody.name).toBe('Ada Lovelace');
    expect(fetchedBody.email).toBe('ada.lovelace@acme-aerospace.example');

    const patched = await liam.patch<{ phone: string; name: string }>(
      `/api/v1/records/contact/${contactId}`,
      {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '+44 20 7946 0066' }),
      },
    );
    expect(patched.ok).toBe(true);
    const patchedBody = await patched.json();
    expect(patchedBody.phone).toBe('+44 20 7946 0066');
    expect(patchedBody.name).toBe('Ada Lovelace');
  });

  test('read a deal and its line items as emma', async ({ api, resetDb }) => {
    await resetDb();
    const emma = api('usr_emma');

    const deal = await emma.get<{ id: string; title: string; amountCents: number }>(
      '/api/v1/records/deal/dls_001',
    );
    const dealBody = await deal.json();
    expect(dealBody.id).toBe('dls_001');
    expect(dealBody.title).toBe('Predictive maintenance rollout');
    expect(dealBody.amountCents).toBe(480000);

    const items = await emma.get<{ items: { totalCents: number }[] }>(
      '/api/v1/deals/dls_001/line-items',
    );
    const itemsBody = await items.json();
    expect(itemsBody.items.length).toBe(3);
  });

  test('read contacts list with pagination as emma', async ({ api, resetDb }) => {
    await resetDb();
    const emma = api('usr_emma');

    const list = await emma.get<{ items: unknown[]; total: number }>(
      '/api/v1/records?type=contact',
    );
    const listBody = await list.json();
    expect(listBody.total).toBe(10);
    expect(listBody.items.length).toBe(10);

    const limited = await emma.get<{ items: unknown[]; total: number }>(
      '/api/v1/records?type=contact&limit=3',
    );
    const limitedBody = await limited.json();
    expect(limitedBody.items.length).toBe(3);
    expect(limitedBody.total).toBe(10);
  });

  test('create contact as raul is denied with 403', async ({ api, resetDb }) => {
    await resetDb();
    const raul = api('usr_raul');

    const res = await raul.post<{ error: string }>('/api/v1/records/contact', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Should Not Exist',
        companyId: 'cmp_acme',
        email: 'nope@acme-aerospace.example',
        phone: '+44 20 7946 0000',
        role: 'Spy',
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('missing actor header returns 401', async ({ resetDb }) => {
    await resetDb();
    const res = await fetch('http://127.0.0.1:4731/api/v1/records?type=contact');
    expect(res.status).toBe(401);
  });
});
