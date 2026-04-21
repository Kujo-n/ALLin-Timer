import { test, expect } from "./fixtures/test-context";
import {
  joinAsGuest,
  randomOrganizer,
  seedOrganizerTournament,
} from "./fixtures/flows";
import { getDocument, listUsers, userExists } from "./fixtures/emulator";

/**
 * Phase 4.5 Task 7 / 8:
 *   - 匿名ゲスト参加者は tournament finished 検知で auth + users/{uid} を自己削除
 *   - 匿名ユーザのログアウトで同様に自己削除
 *   - player ドキュメントは履歴として残存
 *
 * 確認は Emulator REST API (listUsers / getDocument) で実施。
 */

test.describe("匿名ユーザ自己削除", () => {
  test("anonymous guest is deleted from auth + users/{uid} after tournament finished", async ({
    page,
    request,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("finish");
    const { tid } = await seedOrganizerTournament(page, { organizer });

    // 運営者の自己参加 + 匿名ゲスト 2 名受付（計 3 人で tournament 成立）
    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible();

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const guestCtx1 = await browser.newContext();
    const guestCtx2 = await browser.newContext();
    const g1 = await guestCtx1.newPage();
    const g2 = await guestCtx2.newPage();
    await joinAsGuest(g1, tid, "GuestAlice");
    await joinAsGuest(g2, tid, "GuestBob");
    await expect(page.getByText(/参加者 \(3\)/)).toBeVisible({
      timeout: 15_000,
    });

    // 匿名 uid（providerUserInfo が空）を捕捉
    const beforeUsers = await listUsers(request);
    const anonBefore = beforeUsers.filter(
      (u) => (u.providerUserInfo ?? []).length === 0,
    );
    expect(anonBefore.length).toBe(2);
    const anonUids = anonBefore.map((u) => u.localId);

    // 開始 → 匿名ゲスト 2 名バスト → auto-finish 発火
    await dash.startTournament();
    await dash.bustPlayer("GuestAlice");
    await dash.bustPlayer("GuestBob");

    // ゲスト端末で /live を開いたまま tournament finished 検知 → self-delete
    await g1.goto(`/tournaments/${tid}/live`);
    await g2.goto(`/tournaments/${tid}/live`);

    // 匿名 2 人とも Auth Emulator から消えるのを待つ
    await expect
      .poll(
        async () => {
          const users = await listUsers(request);
          return users.filter((u) => anonUids.includes(u.localId)).length;
        },
        {
          message: "expected both anonymous users to be self-deleted from auth",
          timeout: 20_000,
          intervals: [500, 1000, 2000],
        },
      )
      .toBe(0);

    // users/{uid} ドキュメントも消失
    for (const uid of anonUids) {
      const doc = await getDocument(request, `users/${uid}`);
      expect(doc.exists, `users/${uid} still exists`).toBe(false);
    }

    // player ドキュメントは履歴として残存
    for (const uid of anonUids) {
      const doc = await getDocument(request, `tournaments/${tid}/players/${uid}`);
      expect(doc.exists, `players/${uid} should remain as history`).toBe(true);
    }

    await guestCtx1.close();
    await guestCtx2.close();
  });

  test("anonymous user logout deletes auth account", async ({
    page,
    request,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("logout");
    const { tid } = await seedOrganizerTournament(page, { organizer });
    void tournamentDashboardPage; // 明示的に未使用参照を保持

    // 匿名ゲストで受付 → ログアウト動作を検証
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const guestCtx = await browser.newContext();
    const guestPage = await guestCtx.newPage();
    await joinAsGuest(guestPage, tid, "LogoutGuest");

    // 削除前に uid を特定
    const before = await listUsers(request);
    const target = before.find((u) => u.displayName === "LogoutGuest");
    expect(target, "LogoutGuest should exist before logout").toBeDefined();
    const uid = target!.localId;

    // /live からヘッダーのログアウトボタンを押す（AuthBadge 内）
    await guestPage.goto(`/tournaments/${tid}/live`);
    await guestPage.getByRole("button", { name: /ログアウト/ }).click();

    // auth から消えるのを待つ
    await expect
      .poll(async () => userExists(request, uid), {
        timeout: 10_000,
        intervals: [300, 600, 1000],
      })
      .toBe(false);

    // users/{uid} も消えていることを確認
    const doc = await getDocument(request, `users/${uid}`);
    expect(doc.exists).toBe(false);

    await guestCtx.close();
  });
});
