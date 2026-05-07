import { expect, type Locator } from "@playwright/test";

import { BasePage } from "./BasePage";

export class LoginPage extends BasePage {
  readonly loginTab: Locator = this.page.getByRole("tab", { name: "ログイン" });
  readonly registerTab: Locator = this.page.getByRole("tab", { name: "新規登録" });
  readonly emailInput: Locator = this.page.getByLabel("メールアドレス");
  readonly passwordInput: Locator = this.page.getByLabel("パスワード");
  readonly displayNameInput: Locator = this.page.getByLabel("表示名");
  // Google ボタンが「Google で新規登録」「Google でログイン」というラベルになり、
  // Playwright の `name` は default で substring match のため exact: true で
  // form submit ボタンと衝突しないよう絞り込む。
  readonly submitButton: Locator = this.page.getByRole("button", {
    name: /^(ログイン|新規登録)$/,
  });
  readonly emailLinkTab: Locator = this.page.getByRole("tab", { name: "メールリンク" });

  async goto() {
    await this.page.goto("/login");
    await this.waitForStable();
  }

  async register(email: string, password: string, displayName: string) {
    await this.goto();
    await this.registerTab.click();
    await this.displayNameInput.fill(displayName);
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await Promise.all([
      this.page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }),
      this.page.getByRole("button", { name: "新規登録", exact: true }).click(),
    ]);
    await this.waitForStable();
  }

  async login(email: string, password: string) {
    await this.goto();
    await this.loginTab.click();
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await Promise.all([
      this.page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }),
      this.page.getByRole("button", { name: "ログイン", exact: true }).click(),
    ]);
    await this.waitForStable();
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
