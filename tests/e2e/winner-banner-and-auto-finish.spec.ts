import { test, expect } from "./fixtures/test-context";
import {
  joinAsGuest,
  randomOrganizer,
  seedOrganizerTournament,
} from "./fixtures/flows";

/**
 * Phase 4.5 Task 5 / 6:
 *   - 残り 1 人検知で Winner バナー表示
 *   - 2 秒後に state=finished へ自動遷移
 *   - 参加者 (/live) にも同じ Winner バナーが表示
 */

test.describe("Winner 演出 + Auto-finish", () => {
  test(
    "last player remaining triggers winner banner and auto-finish after 2s",
    async ({ page, tournamentDashboardPage, livePage }) => {
      const organizer = randomOrganizer();
      const { tid } = await seedOrganizerTournament(page, { organizer });

      // ---------- 参加者 3 名を別 context からゲスト受付 ----------
      const browser = page.context().browser();
      if (!browser) throw new Error("browser unavailable");
      const guestContexts = await Promise.all([
        browser.newContext(),
        browser.newContext(),
        browser.newContext(),
      ]);
      const guests = [
        { name: "Alice", ctx: guestContexts[0] },
        { name: "Bob", ctx: guestContexts[1] },
        { name: "Carol", ctx: guestContexts[2] },
      ];
      for (const g of guests) {
        const gp = await g.ctx.newPage();
        await joinAsGuest(gp, tid, g.name);
        await gp.close();
      }

      // ---------- 運営者ダッシュボードで 3 人揃うまで待機 ----------
      const dash = tournamentDashboardPage(tid);
      await dash.goto();
      await expect(page.getByText(/参加者 \(3\)/)).toBeVisible({
        timeout: 15_000,
      });

      // ---------- 席決め → 開始 ----------
      await dash.startTournament();
      await expect(dash.stateBadge).toHaveText("進行中");

      // ---------- 2 名バスト ----------
      await dash.bustPlayer("Alice");
      await dash.bustPlayer("Bob");

      // ---------- Winner バナー表示（ダッシュボード） ----------
      await expect(dash.winnerBanner).toBeVisible({ timeout: 5_000 });
      await expect(dash.winnerBanner).toContainText("Carol");

      // ---------- 参加者 /live 画面でも Winner バナー表示を確認 ----------
      // 新規 context から joinAsGuest してしまうと参加者 4 人になり winner 条件
      // （active === 1）が崩れる。組織者と同じ context（同じ auth）で別 tab を
      // 開いて /live を閲覧するだけに留める。resolveWinner は viewer 自身の参加
      // 状態と独立して 3 player snapshot から計算されるため banner は表示される。
      const liveTab = await page.context().newPage();
      await liveTab.goto(`/tournaments/${tid}/live`);
      // Phase 4.12（commit dec92fc）で「優勝」テキストは削除されたため 🏆 でフィルタ。
      const liveBanner = liveTab.getByRole("status").filter({ hasText: "🏆" });
      await expect(liveBanner).toBeVisible({ timeout: 10_000 });
      await expect(liveBanner).toContainText("Carol");
      await liveTab.close();

      // ---------- 2 秒 delay 後に state=finished ----------
      await expect(dash.stateBadge).toHaveText("終了", { timeout: 10_000 });
      // Winner バナーは finished 後も残り続ける
      await expect(dash.winnerBanner).toBeVisible();

      for (const g of guests) await g.ctx.close();
      void livePage; // 未使用 helper の保持（lint 回避）
    },
  );

  test("no winner banner with fewer than 2 total players", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer();
    const { tid } = await seedOrganizerTournament(page, { organizer });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();

    // 運営者 1 人だけ自己参加 → 2 人未満なので資格なし
    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible();

    await dash.startTournament();
    await expect(dash.stateBadge).toHaveText("進行中");

    // 1 人 / 0 人 のいずれも players.length < 2 で resolveWinner は null
    await expect(dash.winnerBanner).toHaveCount(0);
  });
});
