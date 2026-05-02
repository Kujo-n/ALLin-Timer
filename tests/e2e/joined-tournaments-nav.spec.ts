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
 * Phase 5.1: サイドバーの「参加中のトーナメント」section（JoinedTournamentsNav）。
 *
 * 検証する振る舞い:
 *   - 一般メンバーがトーナメントに参加すると、サイドバーに当該トーナメント名が現れる
 *     （collectionGroup query `players where uid==auth.uid` の購読 + 個別 tournament
 *     subscribe の差分管理が動作している）
 *   - 当該トーナメントが finished になるとサイドバーから消える（VISIBLE_STATES から除外）
 *
 * H1: collectionGroup の単一フィールド index は emulator では不要だが、本番では
 * `firestore.indexes.json` の field override が必要。本テストは emulator 上で UI ロジックを
 * 担保するもので、index 抜けによる本番 silent failure は別途デプロイ手順で確認する。
 */

test.describe("Phase 5.1: 参加中のトーナメント sidebar", () => {
  // 2 context（owner / member）+ 招待コード経路 + 開始 → bust → auto-finish まで
  // 通すため default 30s では足りない。
  test.describe.configure({ timeout: 120_000 });

  test(
    "一般メンバーが参加すると sidebar に表示され、finished で消える",
    async ({ page, tournamentDashboardPage }) => {
      // --- owner: group + tournament + 招待 ---
      const owner = randomOrganizer("nav-op");
      await registerOrganizer(page, owner);
      const gid = await createGroup(page, "JoinedNav Group");
      await createDefaultStructure(page, "JoinedNav Default");
      const tid = await createTournament(page, "JoinedNav Cup");
      const inviteUrl = await issueInviteUrl(page, gid);

      // --- member: 別 context で参加 ---
      const browser = page.context().browser();
      if (!browser) throw new Error("browser unavailable");
      const memberCtx = await browser.newContext();
      try {
        const memberPage = await memberCtx.newPage();
        const member = randomOrganizer("nav-mem");
        await registerOrganizer(memberPage, member);
        await consumeInviteUrl(memberPage, inviteUrl);

        // 加入直後の sidebar には「参加中のトーナメント」section は出ない（まだ参加者ではない）。
        // ホームへ戻って sidebar が render される状態で確認する。
        await memberPage.goto("/");
        const joinedSectionLabel = memberPage.getByText("参加中のトーナメント");
        await expect(joinedSectionLabel).toHaveCount(0);

        // /live でワンタップ参加（member-role-split.spec.ts と同じ経路）。
        await memberPage.goto(`/tournaments/${tid}/live`);
        const joinButton = memberPage.getByRole("button", {
          name: /^参加する$/,
        });
        await expect(joinButton).toBeVisible({ timeout: 15_000 });
        await joinButton.click();
        await expect(joinButton).toHaveCount(0, { timeout: 15_000 });

        // ホームに戻って sidebar に「参加中のトーナメント」section + tournament 名が出る。
        // collectionGroup `players where uid==auth.uid` の購読 + 個別 tournament 購読
        // の 2 段 fan-out があり、cold emulator では数秒 race するため 30s 許容。
        await memberPage.goto("/");
        const sidebar = memberPage.locator("#primary-nav-sidebar");
        await expect(sidebar).toBeVisible({ timeout: 15_000 });
        await expect(
          sidebar.getByRole("link", { name: /JoinedNav Cup/ }),
        ).toBeVisible({ timeout: 30_000 });
        // section ラベルも合わせて確認（リンクが先に出ても section <p> が無いと UX が壊れる）。
        await expect(joinedSectionLabel).toBeVisible();

        // owner 側で finished に遷移させる（自己参加 → 開始 → bust → auto-finish）。
        const dash = tournamentDashboardPage(tid);
        await dash.goto();
        // 参加者は member 1 人なので組織者も自己参加で 2 人にする。
        await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({
          timeout: 15_000,
        });
        await dash.selfJoinButton.click();
        await expect(page.getByText(/参加者 \(2\)/)).toBeVisible({
          timeout: 15_000,
        });
        await dash.startTournament();
        // member を bust → 残り 1 人で auto-finish 発火（2 秒 delay）
        await dash.bustPlayer(member.displayName);
        await expect(dash.stateBadge).toHaveText("終了", { timeout: 15_000 });

        // member 側 sidebar から当該 tournament が消える（finished は履歴扱いで除外）。
        await memberPage.goto("/");
        await expect(
          sidebar.getByRole("link", { name: /JoinedNav Cup/ }),
        ).toHaveCount(0, { timeout: 15_000 });
      } finally {
        await memberCtx.close();
      }
      void gid; // 未使用警告抑止（セットアップで使用）
    },
  );
});
