import { test, expect } from "./fixtures/test-context";
import {
  consumeInviteUrl,
  createGroup,
  issueInviteUrl,
  randomOrganizer,
  registerOrganizer,
} from "./fixtures/flows";

/**
 * Phase 4.7: /settings で表示名を更新すると、所属する全 group の
 * `memberDisplayNames[uid]` に反映される（`propagateDisplayNameToGroups`）。
 *
 * 構成:
 *   1. Context A: オーナー登録 → group 作成 → 招待コード発行
 *   2. Context B: 別ユーザ登録 → 招待コードで一般メンバー加入
 *      → /groups/{gid} でオーナーの旧表示名が member 一覧に見える
 *   3. Context A: /settings で表示名変更 → 保存
 *   4. Context B: /groups/{gid} を再読込 → オーナーの**新表示名**が見える
 *
 * 参加者一覧への伝播までを含む end-to-end 経路（auth.displayName 更新 +
 * `memberDisplayNames` 伝播 + 他ユーザへの onSnapshot 反映）を検証する。
 */

test.describe("Phase 4.7: displayName propagation to groups", () => {
  test("owner's /settings update reflects in group member list seen by another member", async ({
    page,
  }) => {
    // --- context A: owner ---
    const owner = randomOrganizer("propO");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Propagation Group");
    const inviteUrl = await issueInviteUrl(page, gid);

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      // --- context B: member ---
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("propM");
      await registerOrganizer(memberPage, member);
      const joinedGid = await consumeInviteUrl(memberPage, inviteUrl);
      expect(joinedGid).toBe(gid);

      // member から group 詳細を開き、owner の「旧表示名」が member 一覧に見える
      await memberPage.goto(`/groups/${gid}`);
      await expect(
        memberPage.getByRole("listitem").filter({ hasText: owner.displayName }),
      ).toBeVisible({ timeout: 15_000 });

      // --- context A: 表示名を更新 ---
      // Phase 4.7: Input maxLength=15 で truncate されることを見越して、15 文字に収まる差分を作る
      const newOwnerName = `${owner.displayName.slice(0, 11)}-new`;
      expect(newOwnerName.length).toBeLessThanOrEqual(15);
      await page.goto("/settings");
      const nameInput = page.getByLabel("表示名");
      await expect(nameInput).toHaveValue(owner.displayName, { timeout: 15_000 });
      await nameInput.fill(newOwnerName);
      await page.getByRole("button", { name: /^保存$/ }).click();
      await expect(page.getByText("保存しました。")).toBeVisible({ timeout: 15_000 });

      // --- context B: 再読込で新表示名を確認（onSnapshot 伝搬の緩衝のため reload）---
      await memberPage.reload();
      await expect(
        memberPage.getByRole("listitem").filter({ hasText: newOwnerName }),
      ).toBeVisible({ timeout: 15_000 });
      // 旧表示名は消えている（新しい `-new` を含まない）
      await expect(
        memberPage
          .getByRole("listitem")
          .filter({ hasText: owner.displayName })
          .filter({ hasNotText: "-new" }),
      ).toHaveCount(0);
    } finally {
      await memberCtx.close();
    }
  });
});
