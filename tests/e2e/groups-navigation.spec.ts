import { test, expect } from "./fixtures/test-context";
import {
  createGroup,
  createDefaultStructure,
  registerOrganizer,
  randomOrganizer,
} from "./fixtures/flows";

/**
 * Phase 4.5 Task 3 / Phase 4.13.1 update:
 *   `/groups/[gid]` 詳細画面から「トーナメント」「ストラクチャ」へ遷移できることを検証。
 *
 *   Phase 4.13.1: ヘッダ右の AuthBadge / 詳細画面のページ内ボタンを廃止し、
 *   サイドバー（PrimaryNav）一本に集約。currentGroupId 反映はサイドバーの
 *   「サークル」配下に表示される group 名サブ項目（href = /groups/{gid}）で確認する。
 */

const SIDEBAR_LABEL = "メインナビゲーション";

test.describe("/groups/[gid] からの画面遷移", () => {
  test("group detail page では sidebar の group サブ項目が現在の gid を指す", async ({
    page,
  }) => {
    const organizer = randomOrganizer("nav");
    await registerOrganizer(page, organizer);
    const gid = await createGroup(page, "E2E Navigation");

    await expect(page).toHaveURL(new RegExp(`/groups/${gid}$`));

    // sidebar に主要 nav 項目が出る
    const sidebar = page.getByRole("complementary", { name: SIDEBAR_LABEL });
    await expect(sidebar.getByRole("link", { name: "トーナメント" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "ストラクチャ" })).toBeVisible();

    // 「サークル」直下の group 名サブ項目が現在の gid を指す
    await expect(sidebar.getByRole("link", { name: "E2E Navigation" })).toHaveAttribute(
      "href",
      `/groups/${gid}`,
    );
  });

  test("sidebar の トーナメント クリックで /tournaments に遷移し、group context が維持される", async ({
    page,
  }) => {
    const organizer = randomOrganizer("nav");
    await registerOrganizer(page, organizer);
    const gid = await createGroup(page, "E2E Nav Tournaments");

    const sidebar = page.getByRole("complementary", { name: SIDEBAR_LABEL });
    await Promise.all([
      page.waitForURL("**/tournaments", { timeout: 10_000 }),
      sidebar.getByRole("link", { name: "トーナメント" }).click(),
    ]);
    // /tournaments でも sidebar の group サブ項目が同じ gid を指している
    await expect(sidebar.getByRole("link", { name: "E2E Nav Tournaments" })).toHaveAttribute(
      "href",
      `/groups/${gid}`,
    );
  });

  test("sidebar の ストラクチャ クリックで /structures に遷移し、group context が維持される", async ({
    page,
  }) => {
    const organizer = randomOrganizer("nav");
    await registerOrganizer(page, organizer);
    const gid = await createGroup(page, "E2E Nav Structures");
    await page.goto(`/groups/${gid}`);
    await createDefaultStructure(page, "Nav Default");
    await page.goto(`/groups/${gid}`);

    const sidebar = page.getByRole("complementary", { name: SIDEBAR_LABEL });
    await Promise.all([
      page.waitForURL("**/structures", { timeout: 10_000 }),
      sidebar.getByRole("link", { name: "ストラクチャ" }).click(),
    ]);
    await expect(sidebar.getByRole("link", { name: "E2E Nav Structures" })).toHaveAttribute(
      "href",
      `/groups/${gid}`,
    );
  });
});
