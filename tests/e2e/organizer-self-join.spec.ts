import { test, expect } from "./fixtures/test-context";
import { seedOrganizerTournament, randomOrganizer } from "./fixtures/flows";

/**
 * Phase 4.5 Task 4: setup 状態のダッシュボードで「自分も参加する」ボタンから
 * 1 クリックで自己参加できる。
 */

test.describe("運営者の自己参加ボタン", () => {
  test("operator can self-join in setup state and button hides after join", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer();
    const { tid } = await seedOrganizerTournament(page, { organizer });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();

    // 初期状態: ボタン表示、参加者 0 人
    await expect(dash.selfJoinButton).toBeVisible();
    await expect(page.getByText(/参加者 \(0\)/)).toBeVisible();

    // 自己参加
    await dash.selfJoinButton.click();

    // 参加者一覧に displayName が現れ、ボタンが消える
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("listitem").filter({ hasText: organizer.displayName }),
    ).toBeVisible();
    await expect(dash.selfJoinButton).toHaveCount(0);

    // ページ再ロードしても hide されたまま
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.getByRole("listitem").filter({ hasText: organizer.displayName }),
    ).toBeVisible();
    await expect(dash.selfJoinButton).toHaveCount(0);
  });
});
