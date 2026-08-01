import { test, expect } from "./fixtures/test-context";
import { getDocument, listUsers } from "./fixtures/emulator";
import {
  consumeInviteUrl,
  createGroup,
  issueInviteUrl,
  randomOrganizer,
  registerOrganizer,
} from "./fixtures/flows";

/**
 * Phase 4 (08-auto-group-join-on-entry): オーナーによるメンバー除外。
 *
 * 共通セットアップ:
 *   1. context A: オーナー登録 → group 作成 → 招待リンク発行
 *   2. context B: 別ユーザー登録 → 招待リンクで一般メンバー加入
 *
 * 検証点:
 *   - 除外すると owner のメンバー一覧から消え、再読込しても復活しない
 *   - 除外された側のサークル一覧からも当該サークルが消える
 *   - 自己修復後は同じ招待リンクで再加入できる
 *   - オーナー自身の行には除外ボタンが出ない（自己除外ガードの UI 側）
 */

/**
 * Emulator REST が返す Firestore document から `users/{uid}.groupIds` を読む。
 *   { fields: { groupIds: { arrayValue: { values: [{ stringValue: "..." }] } } } }
 */
function readGroupIds(doc: { exists: boolean; data?: Record<string, unknown> }): string[] {
  if (!doc.exists) return [];
  const fields = (doc.data?.fields ?? {}) as Record<string, unknown>;
  const groupIdsField = fields["groupIds"] as
    | { arrayValue?: { values?: Array<{ stringValue?: string }> } }
    | undefined;
  return (groupIdsField?.arrayValue?.values ?? []).map((v) => v.stringValue ?? "");
}

test.describe("Phase 4: メンバー除外", () => {
  test("オーナーがメンバーを除外すると一覧から消え、除外された側のサークル一覧からも消える", async ({
    page,
    groupDetailPage,
  }) => {
    const owner = randomOrganizer("rm-owner");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Removal Group");
    const inviteUrl = await issueInviteUrl(page, gid);

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("rm-member");
      await registerOrganizer(memberPage, member);
      expect(await consumeInviteUrl(memberPage, inviteUrl)).toBe(gid);

      // --- owner 側: 一覧に member が見えることを確認してから除外 ---
      const detail = groupDetailPage(gid);
      await detail.goto();
      await detail.expectLoaded();
      await expect(detail.memberRow(member.displayName)).toBeVisible({ timeout: 15_000 });
      await detail.removeMember(member.displayName);

      // 再読込しても復活しない（Firestore に反映されている）
      await detail.goto();
      await detail.expectLoaded();
      await expect(detail.memberRow(member.displayName)).toHaveCount(0);

      // --- member 側: /groups から当該サークルが消える（read が rule で拒否される） ---
      await memberPage.goto("/groups");
      await expect(memberPage.getByText("Removal Group")).toHaveCount(0, {
        timeout: 20_000,
      });
    } finally {
      await memberCtx.close();
    }
  });

  test("除外されたメンバーは招待リンクから再加入できる", async ({
    page,
    request,
    groupDetailPage,
  }) => {
    const owner = randomOrganizer("rj-owner");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Rejoin Group");
    const inviteUrl = await issueInviteUrl(page, gid);

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("rj-member");
      await registerOrganizer(memberPage, member);
      expect(await consumeInviteUrl(memberPage, inviteUrl)).toBe(gid);

      // 自己修復の完了を待つために member の uid が必要。
      // Firebase Auth は email を小文字化して保存するため比較も lowercase で揃える。
      const memberEmailLc = member.email.toLowerCase();
      const target = (await listUsers(request)).find(
        (u) => u.email?.toLowerCase() === memberEmailLc,
      );
      expect(target, `member account ${member.email} should exist`).toBeDefined();
      const memberUid = target!.localId;

      const detail = groupDetailPage(gid);
      await detail.goto();
      await detail.expectLoaded();
      await expect(detail.memberRow(member.displayName)).toBeVisible({ timeout: 15_000 });
      await detail.removeMember(member.displayName);

      // 除外直後は member の `users/{uid}.groupIds` に gid が stale で残る
      //（他人の `users/{uid}` は rule で書けないため）。この状態で招待リンクを踏むと
      // `consumeJoinCode` が「既メンバー」と誤判定して no-op で終わる。
      // 対象者が一度アプリを開くと GroupProvider が failedGids 経由で自己修復するので、
      // その完了（groupIds から gid が消えること）を待ってから再加入する。
      // **この順序は仕様であり実装の都合ではない**
      //（.claude/rules/group-membership.md「オーナーによるメンバー除外」参照）。
      await memberPage.goto("/groups");
      await expect
        .poll(async () => readGroupIds(await getDocument(request, `users/${memberUid}`)), {
          timeout: 20_000,
          intervals: [500, 1000, 2000],
        })
        .not.toContain(gid);

      // 同じ招待リンクで再加入できる（maxUses は null = 無制限）
      expect(await consumeInviteUrl(memberPage, inviteUrl)).toBe(gid);

      await detail.goto();
      await detail.expectLoaded();
      await expect(detail.memberRow(member.displayName)).toBeVisible({ timeout: 15_000 });
    } finally {
      await memberCtx.close();
    }
  });

  test("オーナー自身の行には除外ボタンが出ない", async ({ page, groupDetailPage }) => {
    const owner = randomOrganizer("rm-self");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Self Removal Guard");
    const detail = groupDetailPage(gid);
    await detail.goto();
    await detail.expectLoaded();
    await expect(detail.memberRow(owner.displayName)).toBeVisible({ timeout: 15_000 });
    await expect(detail.removeMemberButton(owner.displayName)).toHaveCount(0);
  });
});
