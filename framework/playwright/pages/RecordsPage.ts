import type { Page, Locator } from 'playwright/test';

export interface RecordRow {
  id: string;
  label: string;
  href: string;
}

export class RecordsPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(type = 'contact', actorId?: string, q?: string): Promise<void> {
    const params = new URLSearchParams({ type });
    if (q) params.set('q', q);
    if (actorId) params.set('actor', actorId);
    await this.page.goto(`/ui?${params.toString()}`);
  }

  // The record list table is the one headed by "Record / Id / Summary".
  // `renderUiPage` also renders a `table.records` for permissions (and the
  // detail view renders one for line items), so scope to the list table only.
  private rowLocator(): Locator {
    return this.page.locator('table.records:has(th:has-text("Record")) tbody tr');
  }

  async rows(): Promise<RecordRow[]> {
    const count = await this.rowLocator().count();
    const result: RecordRow[] = [];
    for (let i = 0; i < count; i++) {
      const row = this.rowLocator().nth(i);
      const cells = row.locator('td');
      const id = (await cells.nth(1).textContent()) ?? '';
      const link = row.locator('td a').first();
      const label = (await link.textContent()) ?? '';
      const href = (await link.getAttribute('href')) ?? '';
      result.push({ id, label, href });
    }
    return result;
  }

  async rowCount(): Promise<number> {
    return await this.rowLocator().count();
  }

  async openRecord(label: string): Promise<void> {
    await this.page.getByRole('link', { name: label }).click();
  }

  async countText(): Promise<string | null> {
    return await this.page.locator('p.count').textContent();
  }

  async emptyMessage(): Promise<string | null> {
    const locator = this.page.locator('p.empty');
    if ((await locator.count()) === 0) return null;
    return await locator.textContent();
  }

  async search(query: string, type = 'contact', actorId?: string): Promise<void> {
    await this.goto(type, actorId, query);
  }

  async hasCreateForm(): Promise<boolean> {
    return await this.page.locator('form[action="/api/v1/records/contact"]').isVisible();
  }

  async createDeniedMessage(): Promise<string | null> {
    return await this.page
      .locator('section.panel h2:has-text("New contact") + p.empty')
      .textContent();
  }
}
