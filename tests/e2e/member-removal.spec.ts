import { test, expect } from "./fixtures/test-context";
import { getDocument, listUsers } from "./fixtures/emulator";
import type { APIRequestContext } from "@playwright/test";
import {
  consumeInviteUrl,
  createGroup,
  issueInviteUrl,
  randomOrganizer,
  registerOrganizer,
  seedOrganizerTournament,
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
 *   - **自己修復を待たずにトーナメント再受付で再加入できる**（招待コード経路との差）
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

/**
 * Auth Emulator からメールアドレスで uid を引く。
 * Firebase Auth は email を小文字化して保存するため比較も lowercase で揃える。
 */
async function resolveUidByEmail(request: APIRequestContext, email: string): Promise<string> {
  const emailLc = email.toLowerCase();
  const target = (await listUsers(request)).find((u) => u.email?.toLowerCase() === emailLc);
  expect(target, `account ${email} should exist`).toBeDefined();
  return target!.localId;
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

      // 除外「前」に member 側でサークルが見えることを固定する。これが無いと、
      // 後段の toHaveCount(0) がページを読めていないだけでも通ってしまう（vacuous pass）。
      // サークル名はサイドバーと一覧カードの 2 箇所に出るため、visible 確認は
      // #main に scope を絞る（strict-mode violation の回避）。
      await memberPage.goto("/groups");
      await expect(memberPage.locator("#main").getByText("Removal Group")).toBeVisible({
        timeout: 15_000,
      });

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
      const memberUid = await resolveUidByEmail(request, member.email);

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

  /**
   * PRD 08 Phase 4 の Success signal（「除名された人が再受付すると再びメンバーになる
   * ＝ stale groupIds に阻害されない」）と、Technical Risks の緩和策そのもの。
   *
   * 直前の招待リンク経路との**対比**が主題:
   *   - `consumeJoinCode` は `users/{uid}.groupIds` で既メンバー判定するため、
   *     除外直後（stale）に踏むと no-op になる → 自己修復の完了を待つ必要がある
   *   - `joinGroupViaTournament` は `getGroup` の成否そのものを membership probe に使うため、
   *     stale な groupIds を参照しない → **待たずにそのまま再加入できる**
   *
   * 同時に、group-membership.md「除外が永続するのは受付可能なトーナメントが
   * 残っていないときだけ」という既知の割り切りを振る舞いとして固定する。
   */
  test("除外されたメンバーはトーナメント再受付でメンバーに戻る（自己修復を待たない）", async ({
    page,
    request,
    groupDetailPage,
  }) => {
    const owner = randomOrganizer("re-owner");
    const groupName = "Rejoin By Entry";
    const { gid, tid } = await seedOrganizerTournament(page, {
      organizer: owner,
      groupName,
      structureName: "Rejoin Default",
      tournamentName: "Rejoin Tournament",
    });

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("re-member");
      await registerOrganizer(memberPage, member);

      // --- 招待コードを一度も使わず、受付だけでメンバーになる（Phase 1〜2 の自動所属） ---
      await memberPage.goto(`/join/${tid}`);
      const receiveButton = memberPage.getByRole("button", { name: "このアカウントで受付" });
      await expect(receiveButton).toBeVisible({ timeout: 15_000 });
      await receiveButton.click();
      // Cold emulator では auth + 複数 Firestore write が走るため 30s 許容。
      await expect(memberPage.getByText("受付完了")).toBeVisible({ timeout: 30_000 });
      await expect(memberPage.getByText(`${groupName} のメンバーになりました。`)).toBeVisible({
        timeout: 15_000,
      });

      // --- owner 側で除外 ---
      const detail = groupDetailPage(gid);
      await detail.goto();
      await detail.expectLoaded();
      await expect(detail.memberRow(member.displayName)).toBeVisible({ timeout: 15_000 });
      await detail.removeMember(member.displayName);

      // 除外直後は member の `users/{uid}.groupIds` に gid が stale で残る
      //（owner は他人の `users/{uid}` を書けないため）。member 側はまだ再読込して
      // いないので自己修復も走っておらず、この時点の観測は決定的。
      const memberUid = await resolveUidByEmail(request, member.email);
      expect(readGroupIds(await getDocument(request, `users/${memberUid}`))).toContain(gid);

      // --- stale なまま再受付する（招待リンク経路のような poll 待機を挟まない） ---
      await memberPage.goto(`/join/${tid}`);
      const rejoinButton = memberPage.getByRole("button", { name: "このアカウントで受付" });
      await expect(rejoinButton).toBeVisible({ timeout: 15_000 });
      await rejoinButton.click();
      // 除外は `players/{uid}` に触れないため受付自体は `already-joined`。
      // それでも自動所属は実行される（PRD Q1(b) の取りこぼし回収）。
      await expect(memberPage.getByText("既に参加済みです")).toBeVisible({ timeout: 30_000 });
      await expect(memberPage.getByText(`${groupName} のメンバーになりました。`)).toBeVisible({
        timeout: 15_000,
      });

      // --- 真実源（`groups/{gid}.memberUids`）でも戻っている ---
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
