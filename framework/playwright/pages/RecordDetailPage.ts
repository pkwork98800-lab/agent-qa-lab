import type { Page, Locator } from 'playwright/test';

export interface LineItemRow {
  id: string;
  product: string;
  qty: string;
  unit: string;
  total: string;
}

export class RecordDetailPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async recordIdentity(): Promise<{ type: string; id: string } | null> {
    const caption = await this.page.locator('table.fields caption').textContent();
    if (!caption) return null;
    const match = caption.match(/^(\w+)\s+(\S+)$/);
    return match ? { type: match[1], id: match[2] } : null;
  }

  async fields(): Promise<Record<string, string>> {
    const count = await this.page.locator('table.fields tbody tr').count();
    const result: Record<string, string> = {};
    for (let i = 0; i < count; i++) {
      const row = this.page.locator('table.fields tbody tr').nth(i);
      const key = (await row.locator('th').textContent()) ?? '';
      const value = (await row.locator('td').textContent()) ?? '';
      result[key.trim()] = value.trim();
    }
    return result;
  }

  async field(name: string): Promise<string | null> {
    return await this.page
      .locator(`table.fields tbody tr:has(th:has-text("${name}")) td`)
      .first()
      .textContent();
  }

  private lineItemLocator(): Locator {
    return this.page.locator('table.records:has(caption:has-text("Line items")) tbody tr');
  }

  async lineItems(): Promise<LineItemRow[]> {
    const count = await this.lineItemLocator().count();
    const result: LineItemRow[] = [];
    for (let i = 0; i < count; i++) {
      const row = this.lineItemLocator().nth(i);
      const cells = row.locator('td');
      result.push({
        id: (await cells.nth(0).textContent()) ?? '',
        product: (await cells.nth(1).textContent()) ?? '',
        qty: (await cells.nth(2).textContent()) ?? '',
        unit: (await cells.nth(3).textContent()) ?? '',
        total: (await cells.nth(4).textContent()) ?? '',
      });
    }
    return result;
  }

  async consistencyMessage(): Promise<string | null> {
    return await this.page.locator('p.ok, p.warn').textContent();
  }

  async hasAppendForm(): Promise<boolean> {
    return await this.page.locator('form[action*="/line-items"]').isVisible();
  }

  async appendLineItem(product: string, qty: string, unitCents: string): Promise<void> {
    const form = this.page.locator('form[action*="/line-items"]');
    await form.getByLabel('product').fill(product);
    await form.getByLabel('qty').fill(qty);
    await form.getByLabel('unitCents').fill(unitCents);
    await form.getByRole('button', { name: 'Append' }).click();
  }
}
