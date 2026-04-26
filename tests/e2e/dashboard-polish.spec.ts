import { test, expect } from "./fixtures/test-context";
import { getDocument } from "./fixtures/emulator";
import { randomOrganizer, seedOrganizerTournament } from "./fixtures/flows";

/**
 * Phase 4.14: ダッシュボード受付画面のポリッシュを E2E でカバーする。
 *
 * 既存 spec で未カバーの 3 領域:
 *   1. 受付画面の右列 3 カードが setup 状態でも描画される（grid 列数の固定 + 「一覧へ戻る」と
 *      raw state バッジが消えていること）
 *   2. ヘッダの「全画面表示」トグルボタンが描画される（実 fullscreen の挙動はブラウザ依存
 *      なので aria-label の存在確認に留める）
 *   3. 終了済みトーナメントの dashboard から削除できる（rule + cascade はユニットテストで
 *      担保済み。ここは UI フローの導線と /tournaments 側の反映のみ確認）
 *
 * いずれの spec も Firestore Emulator 必須（`autoResetEmulator` で毎回 reset）。
 */

test.describe("Phase 4.14: dashboard receipt polish", () => {
  test("setup 状態でも右列 3 カードが描画され、ヘッダから『一覧へ戻る』と raw state バッジが消えている", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("dp-card");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Dashboard Card Preview",
    });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();

    // setup 状態で TimerDisplay 内のラベルは「開始前」。
    await expect(dash.stateBadge).toHaveText("開始前", { timeout: 15_000 });

    // 受付者ゼロのときは AverageStack / Players が render skip される（仕様）ので
    // organizer 自身を 1 名加える。NextBreak は受付者 0 でも描画される。
    await expect(page.getByText("Next Break In")).toBeVisible();

    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({ timeout: 15_000 });

    // 右列 3 カードが setup 状態（受付中）で同時に描画される — Phase 4.14 の中核。
    await expect(page.getByText("Next Break In")).toBeVisible();
    await expect(page.getByText("Average Stack")).toBeVisible();
    await expect(page.getByText("Players")).toBeVisible();

    // AverageStack は setup では「受付中」キャプション、平均 = 初期スタックを示す。
    // 初期スタックは default structure の値（10000）。
    await expect(page.getByText("受付中")).toBeVisible();

    // 「一覧へ戻る」リンク／ボタンはヘッダから消えている（サイドバーで代替）。
    await expect(page.getByRole("link", { name: /一覧へ戻る/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /一覧へ戻る/ })).toHaveCount(0);

    // dashboard ヘッダ（h1 と同じ親 `<header>`）に raw state 文字列が漏れていないこと。
    // TimerDisplay 内の日本語ラベルは検証対象外なので header banner にスコープを絞る。
    const header = page.getByRole("banner");
    await expect(header.getByText(/^(setup|seating|running|paused|finished)$/)).toHaveCount(0);
  });

  test("ヘッダに『全画面表示』トグルボタンが描画され、aria-label が初期状態で『全画面表示』である", async ({
    page,
    tournamentDashboardPage,
  }) => {
    // 1-7: Fullscreen API トグル。実 fullscreen は CI/headless で安定しない（Permission /
    // user-gesture 制約 + headless では `requestFullscreen` が即 reject されることが多い）
    // ため、ここではボタンの存在と初期 aria-label のみ検証する。
    const organizer = randomOrganizer("dp-fs");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Dashboard Fullscreen Toggle",
    });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await expect(dash.stateBadge).toHaveText("開始前", { timeout: 15_000 });

    // Phase 4.14: `/live` への遷移リンクではなく、ページ内 toggle ボタンに置換されている。
    // 旧導線の `<a href="/tournaments/{tid}/live">全画面表示</a>` は存在しない。
    await expect(page.getByRole("link", { name: /^全画面表示$/ })).toHaveCount(0);

    await expect(dash.fullscreenToggle).toBeVisible();
    await expect(dash.fullscreenToggle).toBeEnabled();
    // 初期は fullscreen 解除状態 → aria-label は「全画面表示」。
    await expect(dash.fullscreenToggle).toHaveAttribute("aria-label", "全画面表示");
  });
});

test.describe("Phase 4.14: 終了済みトーナメントの削除", () => {
  test("finished 状態の dashboard から削除すると一覧から消え、Firestore からも除去される", async ({
    page,
    request,
    tournamentDashboardPage,
  }) => {
    // 1-3: 終了済みの cascade 削除。1 名だけ自己参加 → 開始 → 手動終了で finished に到達する。
    // 2 名以上だと auto-finish のタイマーや winner banner と競合するため 1 名で安定させる。
    // unit test (`tournaments.test.ts`) で sub-collection cascade と rule は担保済み。
    // ここでは UI 導線（confirm dialog 文言の分岐 + 一覧反映）を検証する。
    const organizer = randomOrganizer("dp-del");
    const tournamentName = "Dashboard Delete Finished";
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName,
    });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({ timeout: 15_000 });

    await dash.startTournament();
    await expect(dash.stateBadge).toHaveText("進行中");

    // 手動終了。1 名のみなので auto-finish は発火しない（resolveWinner は >=2 名を要求）。
    await dash.clickFinishAndConfirm();
    await expect(dash.stateBadge).toHaveText("終了", { timeout: 10_000 });

    // 削除ボタンが finished で出ていること（旧仕様では setup のみだった）。
    await expect(dash.deleteButton).toBeVisible();
    await dash.deleteButton.click();

    // Confirm dialog が「終了済み」分岐の文言を出す（setup と区別）。
    await expect(dash.deleteConfirmDialog).toBeVisible();
    await expect(dash.deleteConfirmDialog).toContainText(/終了済みのため履歴ごと削除/);

    // 削除実行 → /tournaments へリダイレクト。
    await Promise.all([
      page.waitForURL("**/tournaments", { timeout: 15_000 }),
      dash.confirmDeleteButton.click(),
    ]);

    // /tournaments 一覧から該当トーナメントが消えている。listTournamentsByGroup は
    // 即時 fetch なので reload は不要だが onSnapshot ではないため明示的に
    // 「読込中…」が消えるまで待ち、要素が無いことを確認する。
    await expect(
      page.getByRole("group", { name: new RegExp(tournamentName) }),
    ).toHaveCount(0);

    // Firestore 上でも parent doc が消えていること（cascade の最終証跡として 1 点だけ確認）。
    await expect
      .poll(async () => {
        const snap = await getDocument(request, `tournaments/${tid}`);
        return snap.exists;
      })
      .toBe(false);
  });
});
