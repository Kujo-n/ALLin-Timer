import { test, expect } from "./fixtures/test-context";
import {
  createGroup,
  createDefaultStructure,
  registerOrganizer,
  randomOrganizer,
} from "./fixtures/flows";

/**
 * Phase 4.5 Task 3: `/groups/[gid]` 詳細画面から「トーナメント」「ストラクチャ」
 * ボタンで各画面へ 1 クリック遷移できることを検証。
 *
 * 注意: Task 3 のボタンは `/groups`（一覧）ではなく `/groups/[gid]`（詳細）に置かれる。
 */

test.describe("/groups/[gid] からの画面遷移", () => {
  test("group detail page shows tournaments and structures navigation buttons", async ({
    page,
  }) => {
    const organizer = randomOrganizer("nav");
    await registerOrganizer(page, organizer);
    const gid = await createGroup(page, "E2E Navigation");

    // /groups/[gid] に居る想定
    await expect(page).toHaveURL(new RegExp(`/groups/${gid}$`));

    // 2 つのボタンが visible
    const tournamentsBtn = page.getByRole("button", { name: "トーナメント" });
    const structuresBtn = page.getByRole("button", { name: "ストラクチャ" });
    await expect(tournamentsBtn).toBeVisible();
    await expect(structuresBtn).toBeVisible();
  });

  test("clicking トーナメント navigates to /tournaments with correct group context", async ({
    page,
  }) => {
    const organizer = randomOrganizer("nav");
    await registerOrganizer(page, organizer);
    const gid = await createGroup(page, "E2E Nav Tournaments");

    await page.getByRole("button", { name: "トーナメント" }).click();
    await page.waitForURL("**/tournaments", { timeout: 10_000 });
    // トーナメント一覧が該当 group の context で開かれる（ヘッダーの「現在のサークル」表示）
    await expect(page.getByRole("link", { name: "現在のサークル" })).toHaveAttribute(
      "href",
      `/groups/${gid}`,
    );
  });

  test("clicking ストラクチャ navigates to /structures with correct group context", async ({
    page,
  }) => {
    const organizer = randomOrganizer("nav");
    await registerOrganizer(page, organizer);
    const gid = await createGroup(page, "E2E Nav Structures");
    // ストラクチャ画面で表示させる最低限のデータ
    await page.goto(`/groups/${gid}`);
    await createDefaultStructure(page, "Nav Default");
    // createDefaultStructure は /structures に遷移するので group 詳細に戻る
    await page.goto(`/groups/${gid}`);

    await page.getByRole("button", { name: "ストラクチャ" }).click();
    await page.waitForURL("**/structures", { timeout: 10_000 });
    await expect(page.getByRole("link", { name: "現在のサークル" })).toHaveAttribute(
      "href",
      `/groups/${gid}`,
    );
  });
});
