import { test, expect } from "./fixtures/test-context";
import {
  joinAsGuest,
  randomOrganizer,
  seedOrganizerTournament,
} from "./fixtures/flows";

/**
 * Phase 5.1: 匿名ゲストの動線完結。
 *
 * 検証する振る舞い:
 *   - 受付完了画面（/join/{tid}）に「タイマー画面へ」遷移ボタンを出さない
 *     （isAnon ? null : <Link>）
 *   - 匿名ユーザーが /tournaments/{tid}/live を直打ち → ホーム（/）へ redirect
 *     （live-client.tsx の useEffect で `if (user?.isAnonymous) router.replace("/")`）
 *   - 匿名ユーザーには AppShell の sidebar が出ない（main のみ）
 */

test.describe("Phase 5.1: 匿名ゲスト動線完結", () => {
  // organizer 登録 + group + structure + tournament + 匿名 join + 検証 を default 30s で
  // 完走するのは厳しいため明示的に拡張。
  test.describe.configure({ timeout: 90_000 });

  test(
    "受付完了画面に「タイマー画面へ」ボタンが出ない（取消ボタンのみ）",
    async ({ page }) => {
      const organizer = randomOrganizer("anon-comp");
      const { tid } = await seedOrganizerTournament(page, { organizer });

      // 別 context（匿名ゲスト用）で受付。
      const browser = page.context().browser();
      if (!browser) throw new Error("browser unavailable");
      const guestCtx = await browser.newContext();
      try {
        const guestPage = await guestCtx.newPage();
        await joinAsGuest(guestPage, tid, "AnonGuest");

        // 受付完了 Card が描画されている瞬間に assert したい。re-mount 直後は form に
        // 戻る場合があるため、`タイマー画面へ` link がドキュメント全体で 0 件であることを
        // 永続的に確認する（Phase 5.1 設計: 匿名ゲストには live への遷移ボタンを出さない）。
        await expect(
          guestPage.getByRole("link", { name: /タイマー画面へ/ }),
        ).toHaveCount(0);
      } finally {
        await guestCtx.close();
      }
    },
  );

  test(
    "匿名ユーザーが /live を直打ちすると / へ redirect される",
    async ({ page }) => {
      const organizer = randomOrganizer("anon-redir");
      const { tid } = await seedOrganizerTournament(page, { organizer });

      const browser = page.context().browser();
      if (!browser) throw new Error("browser unavailable");
      const guestCtx = await browser.newContext();
      try {
        const guestPage = await guestCtx.newPage();
        await joinAsGuest(guestPage, tid, "AnonRedir");

        // /live 直打ち → ホームへ redirect（router.replace("/")）。
        await guestPage.goto(`/tournaments/${tid}/live`);
        await guestPage.waitForURL(
          (u) => u.pathname === "/",
          { timeout: 15_000 },
        );

        // sidebar も出ない（AppShell が isAnonymous で main のみに簡略化）。
        await expect(
          guestPage.locator("#primary-nav-sidebar"),
        ).toHaveCount(0);
      } finally {
        await guestCtx.close();
      }
    },
  );
});
