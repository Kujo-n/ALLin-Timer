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
  readonly seatsInput: Locator = this.page.getByLabel("1 Table あたりの席数");
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
  // Phase 5.1: PD（プレイングディーラー）チェックボックス。PlayerList / SeatingBoard
  // 双方で `aria-label="pd-${displayName}"` を共通付与しているため accessible name で参照する。
  pdCheckbox(displayName: string): Locator {
    return this.page.getByLabel(`pd-${displayName}`);
  }
  // SeatingBoard の各テーブルカード（aria-label="table-${tableNum}"）。
  // shadcn の Card は <div> のため role=region を持たない → 属性 selector で直接参照。
  tableCard(tableNum: number): Locator {
    return this.page.locator(`[aria-label="table-${tableNum}"]`);
  }
  // Phase C: 卓ヘッダのタイトル span（`{label}（N 人）` または `Table N（N 人）`）。
  // CardTitle は <div> 実装なので getByText で参照、tableCard 配下に scope 絞り。
  tableHeaderTitle(tableNum: number): Locator {
    return this.tableCard(tableNum).getByText(/（\d+ 人）/);
  }
  // Phase C: 卓ヘッダの「✎」編集ボタン（aria-label="edit-table-${tableNum}"）。
  // organizer 以上 + canEditTableLabel=true のときのみ render される。
  editTableButton(tableNum: number): Locator {
    return this.page.getByRole("button", { name: `edit-table-${tableNum}` });
  }
  // Phase C: 卓 label / color の Dialog（TableLabelEditPopover）。
  // 同 page に同 Dialog が複数存在しないため top-level scope で取り回せる。
  tableLabelInput(tableNum: number): Locator {
    return this.page.getByLabel(`table-label-input-${tableNum}`);
  }
  tableColorInput(tableNum: number): Locator {
    return this.page.getByLabel(`table-color-input-${tableNum}`);
  }
  readonly tableLabelDialogSaveButton: Locator = this.page
    .getByRole("dialog")
    .getByRole("button", { name: /^保存$/ });
  readonly tableLabelDialogClearColorButton: Locator = this.page
    .getByRole("dialog")
    .getByRole("button", { name: /^色なし$/ });

  /**
   * Phase C: dashboard 卓ヘッダから label を編集する 1 操作 helper。
   * `✎` → Dialog 表示 → label 入力 → 保存 までを完結させる（color はそのまま）。
   */
  async editTableLabel(tableNum: number, label: string) {
    await this.editTableButton(tableNum).click();
    const input = this.tableLabelInput(tableNum);
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill(label);
    await this.tableLabelDialogSaveButton.click();
    await expect(this.page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
  }
  // Phase 4.11: TimerControls がアイコン化された後の running/paused 操作ボタン。
  // accessible name は aria-label と一致するため `^...$` で完全一致させる。
  readonly pauseButton: Locator = this.page.getByRole("button", { name: /^一時停止$/ });
  readonly resumeButton: Locator = this.page.getByRole("button", { name: /^再開$/ });
  readonly advanceButton: Locator = this.page.getByRole("button", { name: /^次レベル$/ });
  readonly revertButton: Locator = this.page.getByRole("button", { name: /^前レベル$/ });
  readonly finishButton: Locator = this.page.getByRole("button", { name: /^終了$/ });
  readonly confirmFinishButton: Locator = this.page.getByRole("button", { name: /^終了する$/ });
  // Phase 4.12（commit dec92fc）で WinnerBanner から「優勝」テキストが除去され、
  // 🏆 emoji + winner.displayName の構成に変わった。アクセシブルネームの一部として
  // 残っている 🏆 でフィルタする。
  readonly winnerBanner: Locator = this.page
    .getByRole("status")
    .filter({ hasText: "🏆" });
  // Phase 4.14: dashboard ヘッダの raw state バッジは廃止。TimerDisplay 内の
  // 日本語ラベル（開始前 / 進行中 / 一時停止中 / 終了）をテスト用 selector とする。
  // `aria-label="タイマー"` が付与された section にスコープを絞る。
  readonly stateBadge: Locator = this.page
    .getByRole("region", { name: "タイマー" })
    .getByText(/^(開始前|進行中|一時停止中|終了)$/);
  readonly errorAlert: Locator = this.page.getByRole("alert");
  readonly remainingTime: Locator = this.page.getByLabel("残り時間");
  // Phase 4.14: タイマー操作群（TimerControls）内の「全画面表示」トグルアイコンボタン。
  // 追加要望でヘッダ右上 → サウンドアイコン左横へ移動。aria-label は
  // 「全画面表示」/「全画面表示を解除」で切り替わる（fullscreenchange 連動）。
  readonly fullscreenToggle: Locator = this.page.getByRole("button", {
    name: /^全画面表示(を解除)?$/,
  });
  // Phase 4.14: dashboard ヘッダの「削除」ボタン（destructive）。setup または finished の
  // ときのみ表示される。同名ボタンが Dialog 内にあるため `<header>` scope で絞る必要は無く、
  // 完全一致 `^削除$` で text を限定すれば Dialog の「削除する」とは衝突しない。
  readonly deleteButton: Locator = this.page.getByRole("button", { name: /^削除$/ });
  readonly deleteConfirmDialog: Locator = this.page.getByRole("dialog", {
    name: "トーナメントを削除",
  });
  readonly confirmDeleteButton: Locator = this.page.getByRole("button", {
    name: /^削除する$/,
  });

  async goto() {
    await this.page.goto(`/tournaments/${this.tid}`);
    await this.waitForStable();
  }

  /** setup→seating→running 全工程をまとめて実施する helper。 */
  async startTournament() {
    await this.commitSeatingButton.click();
    await expect(this.startButton).toBeVisible({ timeout: 15_000 });
    await this.startButton.click();
    await expect(this.stateBadge).toHaveText("進行中", { timeout: 15_000 });
  }

  /**
   * Phase 5.1: 席決めだけ commit して seating 状態で止める helper。
   * PD 配置検証など、開始前の SeatingBoard を読みたいテスト用。
   */
  async commitSeatingOnly() {
    await this.commitSeatingButton.click();
    await expect(this.startButton).toBeVisible({ timeout: 15_000 });
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

  // Phase 4.12（commit dec92fc）で WinnerBanner から「優勝」テキストが除去され、
  // 🏆 emoji + winner.displayName の構成に変わった。アクセシブルネームの一部として
  // 残っている 🏆 でフィルタする。
  readonly winnerBanner: Locator = this.page
    .getByRole("status")
    .filter({ hasText: "🏆" });

  async goto() {
    await this.page.goto(`/tournaments/${this.tid}/live`);
    await this.waitForStable();
  }
}
