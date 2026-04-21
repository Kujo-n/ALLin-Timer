import { expect, type Locator, type Page } from "@playwright/test";

import { BasePage } from "./BasePage";

export class GroupsPage extends BasePage {
  async goto() {
    await this.page.goto("/groups");
    await this.waitForStable();
  }

  newGroupLink(): Locator {
    return this.page.getByRole("link", { name: /サークルを新規作成|新規作成/ });
  }
}

export class GroupNewPage extends BasePage {
  readonly nameInput: Locator = this.page.getByLabel("サークル名");
  readonly submitButton: Locator = this.page.getByRole("button", { name: /^作成$/ });

  async goto() {
    await this.page.goto("/groups/new");
    await this.waitForStable();
  }

  /** サークルを作成し、遷移後の `/groups/[gid]` の gid を返す。 */
  async create(name: string): Promise<string> {
    await this.goto();
    await this.nameInput.fill(name);
    await Promise.all([
      this.page.waitForURL(
        (url) => {
          const m = url.pathname.match(/^\/groups\/([^/]+)$/);
          return m !== null && m[1] !== "new" && m[1] !== "join";
        },
        { timeout: 15_000 },
      ),
      this.submitButton.click(),
    ]);
    await this.waitForStable();
    const url = this.page.url();
    const m = url.match(/\/groups\/([^/?#]+)/);
    if (!m) throw new Error(`failed to parse gid from ${url}`);
    return m[1];
  }
}

export class GroupDetailPage extends BasePage {
  constructor(
    page: Page,
    public readonly gid: string,
  ) {
    super(page);
  }

  readonly tournamentsButton: Locator = this.page.getByRole("button", { name: "トーナメント" });
  readonly structuresButton: Locator = this.page.getByRole("button", { name: "ストラクチャ" });

  async goto() {
    await this.page.goto(`/groups/${this.gid}`);
    await this.waitForStable();
  }

  async expectLoaded() {
    // 「メンバー」カードの見出しが出たら読込完了。CardTitle は div 実装なので getByText 利用。
    await expect(this.page.getByText("メンバー", { exact: true })).toBeVisible();
  }
}
