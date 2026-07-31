import { test, expect } from "./fixtures/test-context";
import {
  createDefaultStructure,
  createGroup,
  createTournament,
  joinAsGuest,
  randomOrganizer,
  registerOrganizer,
} from "./fixtures/flows";

/**
 * 08-auto-group-join-on-entry Phase 2: トーナメント受付によるサークル自動所属。
 *
 * **招待コードを 1 回も使わずに**、受付操作だけでサークルメンバーになることを固定する。
 * `issueInviteUrl` / `consumeInviteUrl` を使うと本 Phase の価値の検証にならないため使わない。
 */

const GROUP_NAME = "自動所属サークル";

/** owner 側 (context A) で group + structure + tournament を作る。 */
async function seedOwnerTournament(
  page: import("@playwright/test").Page,
  prefix: string,
): Promise<{ gid: string; tid: string; owner: ReturnType<typeof randomOrganizer> }> {
  const owner = randomOrganizer(prefix);
  await registerOrganizer(page, owner);
  const gid = await createGroup(page, GROUP_NAME);
  await createDefaultStructure(page, "自動所属 Default");
  const tid = await createTournament(page, "自動所属 Tournament");
  return { gid, tid, owner };
}

test.describe("受付によるサークル自動所属", () => {
  test("「このアカウントで受付」でサークルメンバーになる", async ({ page, groupDetailPage }) => {
    const { gid, tid } = await seedOwnerTournament(page, "owner");

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("member");
      await registerOrganizer(memberPage, member);

      // 加入前はサークル 0 件
      await memberPage.goto("/groups");
      await expect(memberPage.getByText("まだサークルがありません")).toBeVisible({
        timeout: 15_000,
      });

      // 受付 → 自動所属
      await memberPage.goto(`/join/${tid}`);
      const receiveButton = memberPage.getByRole("button", {
        name: "このアカウントで受付",
      });
      await expect(receiveButton).toBeVisible({ timeout: 15_000 });
      await receiveButton.click();
      // Cold emulator では auth + 複数 Firestore write が走るため 30s 許容
      //（flows.joinAsGuest と同方針）。
      await expect(memberPage.getByText("受付完了")).toBeVisible({ timeout: 30_000 });
      await expect(memberPage.getByText(`${GROUP_NAME} のメンバーになりました。`)).toBeVisible({
        timeout: 15_000,
      });

      // サークル一覧に出て、詳細画面まで開ける。
      // サークル名はサイドバーのリンクとカード見出しの 2 箇所に出るため、
      // strict mode 違反を避けて #main（一覧カード）とサイドバー link を別々に見る。
      await memberPage.goto("/groups");
      await expect(memberPage.getByRole("link", { name: /^詳細$/ })).toBeVisible({
        timeout: 15_000,
      });
      await expect(memberPage.locator("#main").getByText(GROUP_NAME)).toBeVisible();
      // サイドバーにも出る。ここはフルリロード後なので Firestore に永続化された
      // メンバーシップの検証（ページ内の即時反映は join-client の unit test が
      // setCurrentGroupId / refreshGroups の呼出で担保している）。
      await expect(memberPage.getByRole("link", { name: GROUP_NAME })).toBeVisible();
      await memberPage.goto(`/groups/${gid}`);
      await expect(memberPage.getByRole("tab", { name: "シーズン", exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // owner 側のメンバー一覧にも現れる（招待コード未使用）
      const detail = groupDetailPage(gid);
      await detail.goto();
      await detail.expectLoaded();
      await detail.selectTab("members");
      await expect(page.getByRole("listitem").filter({ hasText: member.displayName })).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await memberCtx.close();
    }
  });

  test("「ログインして受付」でもメンバーになる", async ({ page, groupDetailPage }) => {
    const { gid, tid } = await seedOwnerTournament(page, "owner2");

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");

    // context B: アカウントだけ作る（サークルには入らない）
    const member = randomOrganizer("member2");
    const registerCtx = await browser.newContext();
    try {
      const registerPage = await registerCtx.newPage();
      await registerOrganizer(registerPage, member);
    } finally {
      await registerCtx.close();
    }

    // context C: 未サインイン端末から `/join/[tid]` のログインタブで受付する
    const guestCtx = await browser.newContext();
    try {
      const joinPage = await guestCtx.newPage();
      await joinPage.goto(`/join/${tid}`);
      await joinPage.getByRole("tab", { name: "ログイン" }).click();
      await joinPage.getByLabel("メールアドレス").fill(member.email);
      await joinPage.getByLabel("パスワード").fill(member.password);
      await joinPage.getByRole("button", { name: "ログインして受付" }).click();

      await expect(joinPage.getByText("受付完了")).toBeVisible({ timeout: 30_000 });
      await expect(joinPage.getByText(`${GROUP_NAME} のメンバーになりました。`)).toBeVisible({
        timeout: 15_000,
      });

      await joinPage.goto("/groups");
      await expect(joinPage.locator("#main").getByText(GROUP_NAME)).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await guestCtx.close();
    }

    // owner 側から見てもメンバーが 2 人になっている
    const detail = groupDetailPage(gid);
    await detail.goto();
    await detail.expectLoaded();
    await detail.selectTab("members");
    await expect(page.getByRole("listitem").filter({ hasText: member.displayName })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("匿名ゲスト受付ではメンバーが増えない", async ({ page, groupDetailPage }) => {
    const { gid, tid } = await seedOwnerTournament(page, "owner3");

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const guestCtx = await browser.newContext();
    try {
      const guestPage = await guestCtx.newPage();
      await joinAsGuest(guestPage, tid, "ゲストA");
      // 匿名には所属メッセージを一切出さない
      await expect(guestPage.getByText(/メンバーになりました/)).toHaveCount(0);
    } finally {
      await guestCtx.close();
    }

    // owner 側: メンバーは owner 1 人のまま
    await page.goto("/groups");
    await expect(page.getByText("メンバー 1 人", { exact: false })).toBeVisible({
      timeout: 15_000,
    });

    const detail = groupDetailPage(gid);
    await detail.goto();
    await detail.expectLoaded();
    await detail.selectTab("members");
    await expect(page.getByRole("listitem").filter({ hasText: "ゲストA" })).toHaveCount(0);
  });
});
