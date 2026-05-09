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
    // PRD 02 polish (タブ化) 後: 「メンバー」は tab ラベル + MemberRoleList の Card 見出しの
    // 両方に出るため、getByText("メンバー") は strict-mode 違反になる。tab button が見えた
    // 時点で client-side fetch + render 完了とみなす（hidden 属性は tablist 自体には付かない）。
    await expect(this.tabButton("members")).toBeVisible();
  }

  // PRD 02 polish (タブ化): 3 タブ切替 helper。
  private tabLabel(key: "members" | "season" | "settings"): string {
    if (key === "members") return "メンバー";
    if (key === "season") return "シーズン";
    return "設定";
  }

  tabButton(key: "members" | "season" | "settings"): Locator {
    return this.page.getByRole("tab", { name: this.tabLabel(key), exact: true });
  }

  /** 指定タブをクリックし、対応 panel が visible になるまで待つ。 */
  async selectTab(key: "members" | "season" | "settings"): Promise<void> {
    await this.tabButton(key).click();
    await expect(this.page.locator(`#group-detail-panel-${key}`)).toBeVisible();
  }

  // === サウンド設定 Card 内 locator（PRD 02 polish で旧 AudioSettingsPage.ts から移行）===
  // 「設定」タブ内の `<Card aria-label="audio-settings-card">` に scope を絞り、
  // 同タブ内の `defaultTableLabelsSaveButton` (`name=/^保存$/`) と衝突しないようにする。
  readonly audioSettingsCard: Locator = this.page.locator(
    '[aria-label="audio-settings-card"]',
  );
  // CardTitle は shadcn の <div> で render される（heading role を持たない）。
  // Card scope 内の text matching で「サウンド設定」見出しの presence を確認する。
  readonly audioCardTitle: Locator = this.audioSettingsCard
    .getByText("サウンド設定", { exact: true })
    .first();
  readonly audioEnabledCheckbox: Locator = this.audioSettingsCard.getByRole("checkbox", {
    name: /通知音を有効にする/,
  });
  readonly audioLevelUpSelect: Locator = this.audioSettingsCard.getByLabel(/ブラインド変更時:/);
  readonly audioWinnerSelect: Locator = this.audioSettingsCard.getByLabel(/優勝確定時:/);
  readonly audioVolumeRange: Locator = this.audioSettingsCard.getByLabel(/音量:/);
  readonly audioSaveButton: Locator = this.audioSettingsCard.getByRole("button", {
    name: /^保存$/,
  });
  readonly audioSavedFlash: Locator = this.audioSettingsCard
    .getByRole("status")
    .filter({ hasText: "保存しました" });
  readonly audioBackLink: Locator = this.audioSettingsCard.getByRole("link", {
    name: /(トーナメント受付へ戻る|全画面表示へ戻る)/,
  });

  async expectAudioCardLoaded(): Promise<void> {
    await expect(this.audioCardTitle).toBeVisible({ timeout: 15_000 });
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
   *
   * PRD 02 polish (タブ化) 後は Card が「設定」タブ内にあるため、active tab を確認し、
   * 必要なら設定タブへ切り替えてから編集する。
   */
  async setDefaultTableLabels(labels: string[]): Promise<void> {
    const settingsPanel = this.page.locator("#group-detail-panel-settings");
    if (!(await settingsPanel.isVisible())) {
      await this.selectTab("settings");
    }
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
