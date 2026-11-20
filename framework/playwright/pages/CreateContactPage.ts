import type { Page } from 'playwright/test';

export class CreateContactPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(actorId?: string): Promise<void> {
    const url = actorId
      ? `/ui?actor=${encodeURIComponent(actorId)}&type=contact`
      : '/ui?type=contact';
    await this.page.goto(url);
  }

  readonly nameInput = () => this.page.getByLabel('name');
  readonly companyIdInput = () => this.page.getByLabel('companyId');
  readonly emailInput = () => this.page.getByLabel('email');
  readonly phoneInput = () => this.page.getByLabel('phone');
  readonly roleInput = () => this.page.getByLabel('role');
  readonly createButton = () => this.page.getByRole('button', { name: 'Create contact' });

  async isFormVisible(): Promise<boolean> {
    return await this.page.locator('form[action="/api/v1/records/contact"]').isVisible();
  }

  async deniedMessage(): Promise<string | null> {
    return await this.page
      .locator('section.panel h2:has-text("New contact") + p.empty')
      .textContent();
  }

  async fill(
    name: string,
    companyId: string,
    email: string,
    phone: string,
    role: string,
  ): Promise<void> {
    await this.nameInput().fill(name);
    await this.companyIdInput().fill(companyId);
    await this.emailInput().fill(email);
    await this.phoneInput().fill(phone);
    await this.roleInput().fill(role);
  }

  async create(
    name: string,
    companyId: string,
    email: string,
    phone: string,
    role: string,
  ): Promise<void> {
    await this.fill(name, companyId, email, phone, role);
    await this.createButton().click();
  }

  async createQuick(): Promise<void> {
    await this.create(
      'Test Contact',
      'cmp_acme',
      'test.contact@example.com',
      '+44 20 7946 0099',
      'Lead',
    );
  }
}
