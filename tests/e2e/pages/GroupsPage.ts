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

  async goto() {
    await this.page.goto(`/groups/${this.gid}`);
    await this.waitForStable();
  }

  async expectLoaded() {
    // 「メンバー」カードの見出しが出たら読込完了。CardTitle は div 実装なので getByText 利用。
    await expect(this.page.getByText("メンバー", { exact: true })).toBeVisible();
  }

  // Phase C: 「Table 名デフォルト」カード（GroupDefaultTableLabelsCard）。
  //   - 表示モードでは「未設定」or 番号付きリスト + 「編集」ボタン
  //   - 編集モードでは aria-label="default-table-label-N" の Input × 行数 + 追加 / 保存
  //   - Card root に `aria-label="default-table-labels-card"` を付与しているため
  //     attribute selector で scope を絞れる（同 page には GroupHeaderCard /
  //     InlineNumberEditCard 等にも 編集 / 保存 / キャンセル ボタンが居るため scope 必須）。
  readonly defaultTableLabelsCard: Locator = this.page.locator(
    '[aria-label="default-table-labels-card"]',
  );

  readonly defaultTableLabelsEditButton: Locator = this.defaultTableLabelsCard.getByRole(
    "button",
    { name: /^編集$/ },
  );

  readonly defaultTableLabelsAddButton: Locator = this.defaultTableLabelsCard.getByRole(
    "button",
    { name: /^\+ 追加$/ },
  );

  readonly defaultTableLabelsSaveButton: Locator = this.defaultTableLabelsCard.getByRole(
    "button",
    { name: /^保存$/ },
  );

  defaultTableLabelInput(idx1: number): Locator {
    // 1-origin の order index を accessibleName として埋め込んでいる。
    // `exact: true` 必須 — 同 idx の `remove-default-table-label-${idx1}` ボタンに
    // substring match で衝突するのを防ぐ。
    return this.defaultTableLabelsCard.getByLabel(`default-table-label-${idx1}`, {
      exact: true,
    });
  }

  /**
   * 「編集」→ N 件分 [+ 追加] → 各 Input を fill → [保存] までを 1 操作にまとめる。
   * defaultTableLabels が空の状態から呼ぶ前提（既存 entry を編集する場合は別途扱う）。
   */
  async setDefaultTableLabels(labels: string[]): Promise<void> {
    await this.defaultTableLabelsEditButton.click();
    for (let i = 0; i < labels.length; i += 1) {
      await this.defaultTableLabelsAddButton.click();
      await this.defaultTableLabelInput(i + 1).fill(labels[i]);
    }
    await this.defaultTableLabelsSaveButton.click();
    // 保存後は表示モードに戻り、編集ボタンが再表示される。
    await expect(this.defaultTableLabelsEditButton).toBeVisible({ timeout: 10_000 });
  }
}
