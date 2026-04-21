import { test, expect } from "./fixtures/test-context";
import { seedOrganizerTournament, randomOrganizer } from "./fixtures/flows";

/**
 * Phase 4.5: Email Link サインイン方式を撤廃した後の回帰テスト。
 *   - `/auth/email-link` へ直接アクセスで 404
 *   - `/login` タブは「ログイン」「新規登録」のみ（「メールリンク」不在）
 *   - `/join/[tid]` タブは「ゲスト」「ログイン」のみ（「メール登録」不在）
 */

test.describe("Email Link 撤廃", () => {
  test("/auth/email-link is 404", async ({ page }) => {
    const response = await page.goto("/auth/email-link");
    // Next.js App Router は存在しないルートで 404 を返す。
    expect(response?.status()).toBe(404);
  });

  test("/login has only login + register tabs (no email link tab)", async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.expectTabs(["ログイン", "新規登録"], ["メールリンク"]);
  });

  test("/join/[tid] has only guest + login tabs (no email tab)", async ({
    page,
    joinPage,
  }) => {
    // 受付画面は tid 実在が前提。最小限の seed で運営者 + tournament を作る。
    const organizer = randomOrganizer();
    const { tid } = await seedOrganizerTournament(page, { organizer });

    // 受付画面を別 context で開き、運営者セッションの影響を除外。
    const guestContext = await page.context().browser()?.newContext();
    if (!guestContext) throw new Error("failed to create guest context");
    const guestPage = await guestContext.newPage();
    const guestJoinPage = joinPage(tid);
    // guestPage を POM 側の page に差し替えるより、直接開いて検証する。
    await guestPage.goto(`/join/${tid}`);

    await expect(guestPage.getByRole("tab", { name: "ゲスト" })).toBeVisible();
    await expect(guestPage.getByRole("tab", { name: "ログイン" })).toBeVisible();
    await expect(guestPage.getByRole("tab", { name: "メール登録" })).toHaveCount(0);

    // 未使用だが POM 参照して他パスの回帰も検証可能にしておく。
    void guestJoinPage;

    await guestContext.close();
  });

  test("localStorage has no email-link residue keys after login", async ({
    page,
    loginPage,
  }) => {
    const organizer = randomOrganizer();
    await loginPage.register(organizer.email, organizer.password, organizer.displayName);

    const keys = await page.evaluate(() => {
      const out: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k) out.push(k);
      }
      return out;
    });
    expect(keys).not.toContain("emailForSignIn");
    expect(keys).not.toContain("displayNameForSignIn");
  });
});
