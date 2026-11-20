import { test, expect } from '../../fixtures.ts';

const ROLES = [
  { userId: 'usr_emma', role: 'owner' },
  { userId: 'usr_viktor', role: 'admin' },
  { userId: 'usr_liam', role: 'sales_rep' },
  { userId: 'usr_sofia', role: 'support_agent' },
  { userId: 'usr_raul', role: 'read_only' },
  { userId: 'usr_dana', role: 'external' },
] as const;

type Role = (typeof ROLES)[number]['role'];

function readContactExpectation(role: Role): { status: number; allowed: boolean } {
  // con_001 is cmp_acme. External is company-scoped to cmp_echo -> 404.
  if (role === 'external') return { status: 404, allowed: false };
  return { status: 200, allowed: true };
}

function createContactExpectation(role: Role): { status: number; allowed: boolean } {
  switch (role) {
    case 'owner':
    case 'admin':
    case 'sales_rep':
      return { status: 201, allowed: true };
    case 'support_agent':
    case 'read_only':
    case 'external':
      return { status: 403, allowed: false };
  }
}

test.describe('Permission matrix (BUILD-CONTRACT §3)', () => {
  for (const { userId, role } of ROLES) {
    test(`read contact con_001 as ${role} (${userId})`, async ({ api, resetDb }) => {
      await resetDb();
      const actor = api(userId);
      const expected = readContactExpectation(role);

      const res = await actor.get<{ id: string } | { error: string }>(
        '/api/v1/records/contact/con_001',
      );
      expect(res.status).toBe(expected.status);
      const body = await res.json();
      if (expected.allowed) {
        expect((body as { id: string }).id).toBe('con_001');
      } else {
        expect((body as { error: string }).error).toBeTruthy();
      }
    });
  }

  for (const { userId, role } of ROLES) {
    test(`create contact as ${role} (${userId})`, async ({ api, resetDb }) => {
      await resetDb();
      const actor = api(userId);
      const expected = createContactExpectation(role);

      const res = await actor.post<{ id: string; name: string } | { error: string }>(
        '/api/v1/records/contact',
        {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Matrix Test',
            companyId: 'cmp_acme',
            email: 'matrix.test@acme-aerospace.example',
            phone: '+44 20 7946 0050',
            role: 'Tester',
          }),
        },
      );
      expect(res.status).toBe(expected.status);
      const body = await res.json();
      if (expected.allowed) {
        expect((body as { id: string; name: string }).name).toBe('Matrix Test');
        expect((body as { id: string; name: string }).id).toMatch(/^con_\d+$/);
      } else {
        expect((body as { error: string }).error).toBeTruthy();
      }
    });
  }

  test('read contact con_008 (Echo) as external is allowed (company-scoped)', async ({
    api,
    resetDb,
  }) => {
    await resetDb();
    const dana = api('usr_dana');

    const res = await dana.get<{ id: string; companyId: string }>(
      '/api/v1/records/contact/con_008',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('con_008');
    expect(body.companyId).toBe('cmp_echo');
  });
});
