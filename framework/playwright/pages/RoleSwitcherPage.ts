import type { Page } from 'playwright/test';

export class RoleSwitcherPage {
  readonly page: Page;
  private readonly actorSelectLocator =
    'label:has-text("Demo actor") + select, #actor, [name="actor"]';
  private readonly switchButtonLocator = 'button:has-text("Switch actor")';

  constructor(page: Page) {
    this.page = page;
  }

  get actorSelect() {
    return this.page.getByLabel('Demo actor');
  }

  get switchButton() {
    return this.page.getByRole('button', { name: 'Switch actor' });
  }

  async goto(actorId?: string): Promise<void> {
    const url = actorId ? `/ui?actor=${encodeURIComponent(actorId)}` : '/ui';
    await this.page.goto(url);
  }

  async selectActor(actorId: string): Promise<void> {
    await this.actorSelect.selectOption(actorId);
    await this.switchButton.click();
  }

  async selectedActor(): Promise<string | null> {
    return await this.actorSelect.evaluate((el: HTMLSelectElement) => el.value);
  }

  async currentActorName(): Promise<string> {
    const text = await this.page.locator('header').textContent();
    return text ?? '';
  }
}
