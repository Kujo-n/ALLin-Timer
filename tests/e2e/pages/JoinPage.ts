import { expect, type Locator, type Page } from "@playwright/test";

import { BasePage } from "./BasePage";

export class JoinPage extends BasePage {
  constructor(
    page: Page,
    public readonly tid: string,
  ) {
    super(page);
  }

  readonly guestTab: Locator = this.page.getByRole("tab", { name: "ゲスト" });
  readonly loginTab: Locator = this.page.getByRole("tab", { name: "ログイン" });
  readonly emailTab: Locator = this.page.getByRole("tab", { name: "メール登録" });
  readonly displayNameInput: Locator = this.page.getByLabel("表示名");
  readonly guestSubmitButton: Locator = this.page.getByRole("button", { name: /ゲストで受付/ });
  readonly cancelButton: Locator = this.page.getByRole("button", { name: /参加を取り消す/ });

  async goto() {
    await this.page.goto(`/join/${this.tid}`);
    await this.waitForStable();
  }

  async joinAsGuest(displayName: string) {
    await this.goto();
    await this.guestTab.click();
    await this.displayNameInput.fill(displayName);
    await this.guestSubmitButton.click();
    // 受付完了カードの見出しで完了待機。CardTitle は div 実装なので getByText を使う。
    await expect(this.page.getByText(/受付完了|既に参加済み/)).toBeVisible({
      timeout: 30_000,
    });
  }

  async expectTabs(visible: string[], hidden: string[] = []) {
    for (const name of visible) {
      await expect(this.page.getByRole("tab", { name })).toBeVisible();
    }
    for (const name of hidden) {
      await expect(this.page.getByRole("tab", { name })).toHaveCount(0);
    }
  }
}
