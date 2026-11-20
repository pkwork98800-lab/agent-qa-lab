import type { Page } from 'playwright/test';
import type { RestClient } from '../fixtures.ts';

export interface OutboxItem {
  id: string;
  to: string;
  subject: string;
  body: string;
  actorId: string;
  sentAt: string;
}

export class OutboxPage {
  readonly page: Page;
  readonly api: RestClient;

  constructor(page: Page, api: RestClient) {
    this.page = page;
    this.api = api;
  }

  async goto(): Promise<void> {
    await this.page.goto('/ui');
  }

  async items(to?: string): Promise<OutboxItem[]> {
    const path = to ? `/api/v1/emails?to=${encodeURIComponent(to)}` : '/api/v1/emails';
    const res = await this.api.get<{ items: OutboxItem[] }>(path);
    return (await res.json()).items;
  }

  async count(to?: string): Promise<number> {
    return (await this.items(to)).length;
  }

  async hasEmail(to: string, subject: string): Promise<boolean> {
    const items = await this.items(to);
    return items.some(
      (item) =>
        item.to.toLowerCase() === to.toLowerCase() &&
        item.subject.toLowerCase() === subject.toLowerCase(),
    );
  }

  async latest(): Promise<OutboxItem | null> {
    const items = await this.items();
    return items.length > 0 ? items[items.length - 1] : null;
  }
}
