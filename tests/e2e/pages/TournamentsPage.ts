import { expect, type Locator, type Page } from "@playwright/test";

import { BasePage } from "./BasePage";

export class TournamentsPage extends BasePage {
  async goto() {
    await this.page.goto("/tournaments");
    await this.waitForStable();
  }
}

export class TournamentNewPage extends BasePage {
  readonly nameInput: Locator = this.page.getByLabel("トーナメント名");
  readonly seatsInput: Locator = this.page.getByLabel("1 卓あたりの席数");
  readonly submitButton: Locator = this.page.getByRole("button", { name: /^作成$/ });

  async goto() {
    await this.page.goto("/tournaments/new");
    await this.waitForStable();
  }

  async create(name: string, seatsPerTable = 9): Promise<string> {
    await this.goto();
    await this.nameInput.fill(name);
    await this.seatsInput.fill(String(seatsPerTable));
    await Promise.all([
      this.page.waitForURL(
        (url) => {
          const m = url.pathname.match(/^\/tournaments\/([^/]+)$/);
          return m !== null && m[1] !== "new";
        },
        { timeout: 15_000 },
      ),
      this.submitButton.click(),
    ]);
    await this.waitForStable();
    const url = this.page.url();
    const m = url.match(/\/tournaments\/([^/?#]+)/);
    if (!m) throw new Error(`failed to parse tid from ${url}`);
    return m[1];
  }
}

export class TournamentDashboardPage extends BasePage {
  constructor(
    page: Page,
    public readonly tid: string,
  ) {
    super(page);
  }

  readonly commitSeatingButton: Locator = this.page.getByRole("button", { name: /席を決定/ });
  readonly selfJoinButton: Locator = this.page.getByRole("button", { name: /自分も参加する/ });
  readonly startButton: Locator = this.page.getByRole("button", { name: /トーナメント開始/ });
  // Phase 4.11: TimerControls がアイコン化された後の running/paused 操作ボタン。
  // accessible name は aria-label と一致するため `^...$` で完全一致させる。
  readonly pauseButton: Locator = this.page.getByRole("button", { name: /^一時停止$/ });
  readonly resumeButton: Locator = this.page.getByRole("button", { name: /^再開$/ });
  readonly advanceButton: Locator = this.page.getByRole("button", { name: /^次レベル$/ });
  readonly revertButton: Locator = this.page.getByRole("button", { name: /^前レベル$/ });
  readonly finishButton: Locator = this.page.getByRole("button", { name: /^終了$/ });
  readonly confirmFinishButton: Locator = this.page.getByRole("button", { name: /^終了する$/ });
  readonly winnerBanner: Locator = this.page
    .getByRole("status")
    .filter({ hasText: "優勝" });
  readonly stateBadge: Locator = this.page
    .locator("header")
    .getByText(/^(setup|seating|running|paused|finished)$/);
  readonly errorAlert: Locator = this.page.getByRole("alert");
  readonly remainingTime: Locator = this.page.getByLabel("残り時間");

  async goto() {
    await this.page.goto(`/tournaments/${this.tid}`);
    await this.waitForStable();
  }

  /** setup→seating→running 全工程をまとめて実施する helper。 */
  async startTournament() {
    await this.commitSeatingButton.click();
    await expect(this.startButton).toBeVisible({ timeout: 15_000 });
    await this.startButton.click();
    await expect(this.stateBadge).toHaveText("running", { timeout: 15_000 });
  }

  async bustPlayer(displayName: string) {
    // BustButton は aria-label="bust-${pid}" を設定しているため accessible name は
    // 表示テキスト "バスト" ではなく "bust-<uid>" になる。PlayerList の listitem に絞り込んだ上で
    // name=/^bust-/ のボタンをクリック。SeatingBoard 側にはバストボタン自体無いので選ばれない。
    const bustButtonLocator = this.page.getByRole("button", { name: /^bust-/ });
    const row = this.page.getByRole("listitem").filter({
      hasText: displayName,
      has: bustButtonLocator,
    });
    await row.getByRole("button", { name: /^bust-/ }).click();
  }

  async getStateBadgeText(): Promise<string> {
    return (await this.stateBadge.textContent())?.trim() ?? "";
  }

  /**
   * Phase 4.11: 終了ボタン（Square アイコン）→ 確認ダイアログ → 「終了する」までのフロー。
   * state badge が "finished" になるまで待機する。
   */
  async clickFinishAndConfirm() {
    await this.finishButton.click();
    await this.confirmFinishButton.click();
  }
}

export class LivePage extends BasePage {
  constructor(
    page: Page,
    public readonly tid: string,
  ) {
    super(page);
  }

  readonly winnerBanner: Locator = this.page
    .getByRole("status")
    .filter({ hasText: "優勝" });

  async goto() {
    await this.page.goto(`/tournaments/${this.tid}/live`);
    await this.waitForStable();
  }
}
