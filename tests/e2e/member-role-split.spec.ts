import { test, expect } from "./fixtures/test-context";
import {
  consumeInviteUrl,
  createGroup,
  createDefaultStructure,
  createTournament,
  issueInviteUrl,
  randomOrganizer,
  registerOrganizer,
} from "./fixtures/flows";

/**
 * Phase 4.6: 3 階層ロール（owner / organizer / general member）の UX 境界を検証。
 *
 * 共通セットアップ:
 *   1. Browser context A: オーナー登録 → group + structure + tournament 作成 → 招待コード発行
 *   2. Browser context B: 別ユーザ登録 → 招待コードを踏んで一般メンバー加入
 *
 * 各テストで context B が「一般メンバーとして見える範囲」を検証する。
 */

test.describe("Phase 4.6: member role split UX", () => {
  test("general member sees /tournaments without 新規作成 button, and sees 参加する CTA", async ({
    page,
  }) => {
    // --- owner 側 (context A) ---
    const owner = randomOrganizer("owner");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Role Split Group");
    await createDefaultStructure(page, "Role Split Default");
    const tid = await createTournament(page, "Role Split Tournament");
    const inviteUrl = await issueInviteUrl(page, gid);

    // --- member 側 (context B) ---
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("member");
      await registerOrganizer(memberPage, member);
      const joinedGid = await consumeInviteUrl(memberPage, inviteUrl);
      expect(joinedGid).toBe(gid);

      // /tournaments に遷移
      await memberPage.goto("/tournaments");
      // page-level（#main 配下）には organizer 限定 CTA が出ない。
      // Phase 4.13.1: ストラクチャはサイドバーから誰でも開けるようになったため、
      // 「ストラクチャがページ内にない」を #main スコープでだけ検証する。
      const memberMain = memberPage.locator("#main");
      await expect(
        memberMain.getByRole("link", { name: /^新規作成$/ }),
      ).toHaveCount(0);
      await expect(
        memberMain.getByRole("link", { name: /^ストラクチャ$/ }),
      ).toHaveCount(0);
      // 代わりにトーナメントカードに「参加する」CTA が表示される
      await expect(memberPage.getByText("Role Split Tournament")).toBeVisible();
      await expect(
        memberPage.getByRole("link", { name: /^参加する$/ }),
      ).toBeVisible();
      // 運営専用の「運営」ボタンは member には出ない
      await expect(
        memberPage.getByRole("link", { name: /^運営$/ }),
      ).toHaveCount(0);
    } finally {
      await memberCtx.close();
    }
    // 参照未使用変数の警告抑止（tid はセットアップ時に使用）
    void tid;
  });

  test("general member visiting /tournaments/[tid] is redirected to /live", async ({
    page,
  }) => {
    const owner = randomOrganizer("owner2");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Redirect Group");
    await createDefaultStructure(page, "Redirect Default");
    const tid = await createTournament(page, "Redirect Tournament");
    const inviteUrl = await issueInviteUrl(page, gid);

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("member2");
      await registerOrganizer(memberPage, member);
      await consumeInviteUrl(memberPage, inviteUrl);

      // 一般メンバーが URL 直打ちで dashboard を踏もうとすると /live へ redirect
      await memberPage.goto(`/tournaments/${tid}`);
      await memberPage.waitForURL(`**/tournaments/${tid}/live`, { timeout: 15_000 });

      // live 画面の主要要素（タイマー / 自席セクション）が表示される。
      // Phase 4.13 で AppShell が `<main id="main">` を追加したため、live-client の
      // page-level `<main>` と二重になり `locator("main")` は strict-mode violation を
      // 起こす。AppShell 側の `#main` を直接参照して fullscreen pattern が機能している
      // ことを確認する。
      await expect(memberPage.locator("#main")).toBeVisible();
    } finally {
      await memberCtx.close();
    }
  });

  test("general member can one-tap join the tournament from /live", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const owner = randomOrganizer("owner3");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Join CTA Group");
    await createDefaultStructure(page, "Join CTA Default");
    const tid = await createTournament(page, "Join CTA Tournament");
    const inviteUrl = await issueInviteUrl(page, gid);

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("member3");
      await registerOrganizer(memberPage, member);
      await consumeInviteUrl(memberPage, inviteUrl);

      // /live で「参加する」ボタンをクリック
      await memberPage.goto(`/tournaments/${tid}/live`);
      const joinButton = memberPage.getByRole("button", { name: /^参加する$/ });
      await expect(joinButton).toBeVisible({ timeout: 15_000 });
      await joinButton.click();

      // 参加成功後、ボタンは消え「席決め待ち中…」になるか、自席情報が埋まる
      await expect(joinButton).toHaveCount(0, { timeout: 15_000 });
      await expect(
        memberPage.getByText(/席決め待ち中…|受付登録されていません/).first(),
      ).toBeVisible();
      // 誤って「参加登録していません」に戻っていないこと
      await expect(memberPage.getByText("受付登録されていません")).toHaveCount(0);

      // オーナー側ダッシュボードで member が players に追加されていることを確認
      const dash = tournamentDashboardPage(tid);
      await dash.goto();
      await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole("listitem").filter({ hasText: member.displayName }),
      ).toBeVisible();
    } finally {
      await memberCtx.close();
    }
  });
});
