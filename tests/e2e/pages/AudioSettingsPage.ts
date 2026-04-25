import { expect, type Locator, type Page } from "@playwright/test";

import { BasePage } from "./BasePage";

/**
 * Phase 4.9: `/groups/[gid]/audio-settings` 用 POM。
 *
 * 主要な要素:
 *  - "通知音を有効にする" checkbox
 *  - "ブラインド変更時:" / "優勝確定時:" の <select>
 *  - 音量 range slider
 *  - 保存 / キャンセル
 *
 * audio-settings-client.tsx の `useEffect` は group fetch 後に setState で見出しが
 * 出るので、`expectLoaded()` で「サウンド設定」見出しが visible になるまで待機する。
 */
export class GroupAudioSettingsPage extends BasePage {
  constructor(
    page: Page,
    public readonly gid: string,
  ) {
    super(page);
  }

  readonly heading: Locator = this.page.getByRole("heading", { name: "サウンド設定" });
  readonly enabledCheckbox: Locator = this.page.getByRole("checkbox", {
    name: /通知音を有効にする/,
  });
  readonly levelUpSelect: Locator = this.page.getByLabel(/ブラインド変更時:/);
  readonly winnerSelect: Locator = this.page.getByLabel(/優勝確定時:/);
  readonly volumeRange: Locator = this.page.getByLabel(/音量:/);
  readonly saveButton: Locator = this.page.getByRole("button", { name: /^保存$/ });
  readonly cancelLink: Locator = this.page.getByRole("link", { name: /^キャンセル$/ });

  async goto() {
    await this.page.goto(`/groups/${this.gid}/audio-settings`);
    await this.waitForStable();
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
  }
}
