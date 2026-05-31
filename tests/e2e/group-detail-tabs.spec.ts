import { test, expect } from "./fixtures/test-context";
import { createGroup, randomOrganizer, registerOrganizer } from "./fixtures/flows";

/**
 * PRD 02 polish (タブ化): サークル詳細画面の 3 タブ切替（メンバー / シーズン / 設定）。
 *
 * 検証対象:
 *   1. default は `?tab=` 無しで `members` タブが選択される
 *   2. タブクリックで `?tab=` クエリが同期し、対応 panel のみが visible
 *   3. `?tab=settings` 直リンクで設定タブが復元される
 *   4. 不正 `?tab=foo` は `members` にフォールバック（isTabKey type guard）
 *   5. モバイル幅でサークル名 inline edit 中も「削除」ボタンが actionability チェックを
 *      通過する（= 重なって誤タップしない構造）
 */

test.describe("サークル詳細画面のタブ", () => {
  test("default で『メンバー』タブが選択され、メンバーカードが見える", async ({
    page,
    groupDetailPage,
  }) => {
    const owner = randomOrganizer("tab-default");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Tab Default Group");
    const detail = groupDetailPage(gid);
    await detail.goto();
    await detail.expectLoaded();

    await expect(detail.tabButton("members")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#group-detail-panel-members")).toBeVisible();
    await expect(page.locator("#group-detail-panel-season")).toBeHidden();
    await expect(page.locator("#group-detail-panel-settings")).toBeHidden();
    // owner は招待コードカードもメンバータブで見える
    await expect(
      page.getByRole("button", { name: "招待コードを発行" }),
    ).toBeVisible();
  });

  test("『シーズン』タブをクリックすると ?tab=season になり、SeasonCard が見える", async ({
    page,
    groupDetailPage,
  }) => {
    const owner = randomOrganizer("tab-season");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Tab Season Group");
    const detail = groupDetailPage(gid);
    await detail.goto();
    await detail.expectLoaded();

    await detail.selectTab("season");
    await expect(page).toHaveURL(/[?&]tab=season(&|$)/);
    await expect(
      page.getByRole("button", { name: /^シーズンを開始する$/ }),
    ).toBeVisible();
    // Phase 2 (06): 戦績 0 件の素のサークルではインライン順位表は出ず、案内文が見える。
    await detail.expectSeasonRankingEmpty();
    // 設定タブ配下のカードはこのタブでは見えない
    await expect(page.getByText("Table 名デフォルト")).toBeHidden();
  });

  test("?tab=settings で直リンクすると設定タブが復元される", async ({ page }) => {
    const owner = randomOrganizer("tab-deep");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Tab Deep Group");
    await page.goto(`/groups/${gid}?tab=settings`);

    await expect(page.locator("#group-detail-panel-settings")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Table 名デフォルト")).toBeVisible();
    await expect(page.getByText("開催数")).toBeVisible();
    // organizer 視点では AudioSettingsCard も設定タブに見える。
    // shadcn CardTitle は <div> で heading role を持たないため Card scope + getByText で確認。
    await expect(
      page.locator('[aria-label="audio-settings-card"]'),
    ).toBeVisible();
  });

  test("不正な ?tab=foo は members タブにフォールバックする", async ({ page }) => {
    const owner = randomOrganizer("tab-bad");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Tab Bad Group");
    await page.goto(`/groups/${gid}?tab=foo`);

    await expect(
      page.getByRole("tab", { name: "メンバー", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#group-detail-panel-members")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("ヘッダ rename inline edit 中もモバイル幅で削除ボタンが click できる（重なり無し）", async ({
    page,
    groupDetailPage,
  }) => {
    const owner = randomOrganizer("tab-overlap");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Header Overlap Group");
    const detail = groupDetailPage(gid);
    // モバイル幅にしてレイアウトの崩れを再現
    await page.setViewportSize({ width: 375, height: 667 });
    await detail.goto();
    await detail.expectLoaded();

    // サークル名の Pencil クリックで inline edit に入る
    await page.getByRole("button", { name: /^サークル名「.+」を編集$/ }).click();
    const renameInput = page.getByLabel("サークル名");
    await expect(renameInput).toBeVisible();

    // Playwright の click は actionability チェックで「他要素に覆われていない」ことを
    // 検証する。モバイル幅で削除ボタンが visible かつ click 可能 = 重なっていない構造。
    const deleteBtn = page.getByRole("button", { name: "削除" });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // 削除 dialog が開いた = 誤タップではなく「削除」ボタン本体が click できたこと。
    await expect(
      page.getByRole("dialog").getByText("サークルを削除"),
    ).toBeVisible({ timeout: 10_000 });
  });
});
