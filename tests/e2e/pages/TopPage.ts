import { expect, type Locator } from "@playwright/test";

import { BasePage } from "./BasePage";

export class TopPage extends BasePage {
  readonly heading: Locator = this.page.getByRole("heading", { name: "ALLin-PokerTimer" });
  readonly loginRegisterButton: Locator = this.page.getByRole("button", {
    name: "ログイン / 新規登録",
  });
  readonly groupsButton: Locator = this.page.getByRole("button", { name: "サークル一覧へ" });
  readonly tournamentsButton: Locator = this.page.getByRole("button", {
    name: "トーナメント一覧へ",
  });

  async goto() {
    await this.page.goto("/");
    await this.waitForStable();
  }

  async expectSignedOutLayout() {
    await expect(this.heading).toBeVisible();
    await expect(this.loginRegisterButton).toBeVisible();
    await expect(this.groupsButton).toHaveCount(0);
    await expect(this.tournamentsButton).toHaveCount(0);
  }

  async expectSignedInLayout() {
    await expect(this.heading).toBeVisible();
    await expect(this.groupsButton).toBeVisible();
    await expect(this.tournamentsButton).toBeVisible();
    await expect(this.loginRegisterButton).toHaveCount(0);
  }
}
