import { test, expect } from "./fixtures/test-context";
import { getDocument, listUsers, userExists } from "./fixtures/emulator";
import {
  consumeInviteUrl,
  createGroup,
  issueInviteUrl,
  randomOrganizer,
  registerOrganizer,
} from "./fixtures/flows";

/**
 * 通常アカウント自己削除の E2E（plan の Task 8）。
 *
 * シナリオ:
 *   1. sole-owner block — 自分が唯一のオーナーのサークルが残っているとき、
 *      /settings の「アカウントを削除する」操作はサークル名を提示する block
 *      dialog で停止する（user.delete は呼ばれない）。
 *   2. 正常削除 — co-owner が居るサークルのみに所属するユーザーが削除を実行
 *      すると、Auth Emulator から uid が消え、`users/{uid}` も消え、
 *      group の `memberUids` からも除外される。
 *
 * `auth/requires-recent-login` 系は Auth Emulator が時間進行を fake できない
 * ため unit test 側 (`account-delete.test.ts`) で担保し、E2E では扱わない。
 */

test.describe("通常アカウント自己削除", () => {
  test("blocks deletion when user is the sole owner of a group", async ({ page }) => {
    const owner = randomOrganizer("soleO");
    await registerOrganizer(page, owner);
    const groupName = "唯一オーナー";
    await createGroup(page, groupName);

    await page.goto("/settings");
    await page
      .getByRole("button", { name: "アカウントを削除する" })
      .click();
    // 確認 dialog → 「削除する」を押す
    await page.getByRole("button", { name: "削除する" }).click();

    // sole-owner block dialog にサークル名が表示される。
    // sidebar / ヘッダなどページ chrome にも同じ group 名が表示されうるため、
    // 必ず dialog 内に scope して strict-mode 違反を避ける。
    const blockedDialog = page.getByRole("dialog").filter({ hasText: "削除できません" });
    await expect(blockedDialog).toBeVisible({ timeout: 15_000 });
    await expect(blockedDialog.getByText(groupName)).toBeVisible();

    // ESC で dialog を閉じる。shadcn Dialog は footer の「閉じる」ボタンと
    // 右上 X アイコン (sr-only="閉じる") の 2 つが accessible name を共有するため、
    // role-based click は strict-mode 違反になる。ESC のほうが確実かつ自然。
    await page.keyboard.press("Escape");
    await expect(blockedDialog).not.toBeVisible({ timeout: 5_000 });
    // この時点で Auth セッションは生きている（削除されていない）
    await expect(page.getByLabel("表示名")).toBeVisible();
  });

  test("deletes account, leaves co-owned group, and removes user doc when not sole owner", async ({
    page,
    request,
  }) => {
    // --- context A: owner registers and creates group, issues invite ---
    const owner = randomOrganizer("delO");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Co-owned Group");
    const inviteUrl = await issueInviteUrl(page, gid);

    // --- context B: member registers and joins via invite ---
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("delM");
      await registerOrganizer(memberPage, member);
      const joined = await consumeInviteUrl(memberPage, inviteUrl);
      expect(joined).toBe(gid);

      // 削除前に member の uid を Auth Emulator から取得。
      // Firebase Auth は email を小文字化して保存するため、比較も lowercase で揃える。
      const memberEmailLc = member.email.toLowerCase();
      const usersBefore = await listUsers(request);
      const target = usersBefore.find(
        (u) => u.email?.toLowerCase() === memberEmailLc,
      );
      expect(target, `member account ${member.email} should exist before delete`).toBeDefined();
      const memberUid = target!.localId;

      // member が co-owner のサークルから安全に脱退できる前提を確認するため、
      // owner が member を organizer に昇格してから owner にも昇格する。
      // これにより member 視点では「自分以外にも owner がいる group」となり、
      // sole-owner block を通過できる。
      // Phase 4.6 UI: /groups/{gid} のメンバー操作（昇格ボタン）を使う。
      await page.goto(`/groups/${gid}`);
      const memberRow = page
        .getByRole("listitem")
        .filter({ hasText: member.displayName });
      await expect(memberRow).toBeVisible({ timeout: 15_000 });
      // 「運営へ昇格」ボタンを押す
      await memberRow.getByRole("button", { name: /運営へ昇格/ }).click();
      // 続けて「オーナーへ昇格」ボタンが出るので押す（同じ列内）。
      // 反映後の onSnapshot を待ってから探索する。
      await expect(
        memberRow.getByRole("button", { name: /オーナーへ昇格/ }),
      ).toBeVisible({ timeout: 15_000 });
      await memberRow.getByRole("button", { name: /オーナーへ昇格/ }).click();
      await expect(memberRow.getByText(/オーナー/)).toBeVisible({ timeout: 15_000 });

      // --- member が /settings から削除を実行 ---
      await memberPage.goto("/settings");
      await memberPage
        .getByRole("button", { name: "アカウントを削除する" })
        .click();
      await memberPage.getByRole("button", { name: "削除する" }).click();

      // 削除後は AuthProvider が user=null になり RequireAuth が /settings から離脱させる。
      // 環境により遷移先は `/` or `/login?redirect=/settings` のどちらにも倒れうるため、
      // 「/settings から去ったこと」を成功条件にする。
      await memberPage.waitForURL(
        (url) => url.pathname !== "/settings",
        { timeout: 20_000 },
      );

      // Auth Emulator から uid が消える
      await expect
        .poll(async () => userExists(request, memberUid), {
          timeout: 15_000,
          intervals: [500, 1000, 2000],
        })
        .toBe(false);

      // users/{uid} も消えている
      const userDoc = await getDocument(request, `users/${memberUid}`);
      expect(userDoc.exists).toBe(false);

      // group の memberUids から uid が除外されている
      const groupDoc = await getDocument(request, `groups/${gid}`);
      expect(groupDoc.exists).toBe(true);
      // emulator REST が返す Firestore document の構造に揃える:
      //   { fields: { memberUids: { arrayValue: { values: [{stringValue: "..."}, ...] } } } }
      const fields = (groupDoc.data?.fields ?? {}) as Record<string, unknown>;
      const memberUidsField = fields["memberUids"] as
        | { arrayValue?: { values?: Array<{ stringValue?: string }> } }
        | undefined;
      const memberUids = (memberUidsField?.arrayValue?.values ?? []).map(
        (v) => v.stringValue ?? "",
      );
      expect(memberUids).not.toContain(memberUid);
    } finally {
      await memberCtx.close();
    }
  });
});
