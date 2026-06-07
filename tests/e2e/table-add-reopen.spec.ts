import { test, expect, type Page } from "./fixtures/test-context";
import { randomOrganizer, seedOrganizerTournament } from "./fixtures/flows";

/**
 * Phase 4 (07-third-dryrun-improvements): 卓を増やす／閉じた卓を再開する observable な振る舞い。
 *
 * engine.planAddTable / repositories.reopenTable / useTableLifecycle / UnseatedPlayersGuide /
 * SeatingBoard の各層は unit / component test で網羅済み。E2E では lifecycle のラウンドトリップ
 * （閉じる→再開で復活 / 卓追加でカード出現 / MAX_TABLES で追加 disabled / 未配席ガイド表示）を
 * ユーザー観測点として固定する。@dnd-kit の実ドラッグは Playwright で flaky なため、
 * D&D droppability は SeatingBoard.test（component）で担保し、ここでは扱わない。
 */

/** 名前のみ（ゲスト）参加者を「参加者を追加」ダイアログから 1 名代理受付する。 */
async function addNamedGuest(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "参加者を追加" }).click();
  const dialog = page.getByRole("dialog", { name: /参加者を追加/ });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("tab", { name: "ゲストで追加" }).click();
  await dialog.getByLabel("表示名").fill(name);
  await Promise.all([
    expect(dialog).toBeHidden({ timeout: 15_000 }),
    dialog.getByRole("button", { name: /^追加$/ }).click(),
  ]);
}

test.describe("Phase 4: 卓を増やす／再開", () => {
  // 冷えた emulator + organizer 登録 + 代理受付 + commit seating まで通すため拡張。
  test.describe.configure({ timeout: 120_000 });

  test("卓を閉じてから再開すると「閉鎖」バッジが消え「閉じる」ボタンが復活する", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("reopen");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Reopen Table",
      seatsPerTable: 2,
    });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();

    // 名前のみ 5 名を代理受付。seatsPerTable=2 → ceil(5/2)=3 卓（2/2/1）。
    for (const name of ["Pa", "Pb", "Pc", "Pd", "Pe"]) {
      await addNamedGuest(page, name);
    }
    await expect(page.getByText(/参加者 \(5\)/)).toBeVisible({ timeout: 15_000 });

    await dash.commitSeatingOnly();
    await expect(dash.tableCard(3)).toBeVisible({ timeout: 15_000 });

    // 卓3（最少 1 名）を閉じる。
    await page.getByTestId("close-table-3").click();
    const confirm = page.getByTestId("close-table-confirm");
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    await confirm.click();

    // 閉鎖後: 卓3 は「閉鎖」バッジ + 「再開」ボタン。「閉じる」は出ない。
    await expect(dash.tableCard(3).getByText("閉鎖")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("reopen-table-3")).toBeVisible();
    await expect(page.getByTestId("close-table-3")).toHaveCount(0);

    // 再開 → 「閉鎖」バッジが消え「閉じる」ボタンが復活。
    await page.getByTestId("reopen-table-3").click();
    await expect(dash.tableCard(3).getByText("閉鎖")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("close-table-3")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("reopen-table-3")).toHaveCount(0);
  });

  test("「卓を追加」で新しい空卓カードが出現する", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("addtbl");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Add Table",
      seatsPerTable: 2,
    });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();

    // 名前のみ 4 名 → seatsPerTable=2 で 2 卓。
    for (const name of ["Pa", "Pb", "Pc", "Pd"]) {
      await addNamedGuest(page, name);
    }
    await expect(page.getByText(/参加者 \(4\)/)).toBeVisible({ timeout: 15_000 });

    await dash.commitSeatingOnly();
    await expect(dash.tableCard(2)).toBeVisible({ timeout: 15_000 });
    // 追加前は卓3 が存在しない。
    await expect(dash.tableCard(3)).toHaveCount(0);

    // 「卓を追加」→ 卓3 のカード（0 人・空席）が出現。
    await page.getByTestId("add-table").click();
    await expect(dash.tableCard(3)).toBeVisible({ timeout: 15_000 });
    await expect(dash.tableHeaderTitle(3)).toContainText("（0 人）");
  });

  test("MAX_TABLES(6) に達すると「卓を追加」ボタンが disabled になる", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("maxtbl");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Max Tables",
      seatsPerTable: 2,
    });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();

    // 名前のみ 12 名 → seatsPerTable=2 で 6 卓（MAX_TABLES）。
    for (let i = 1; i <= 12; i++) {
      await addNamedGuest(page, `P${String(i).padStart(2, "0")}`);
    }
    await expect(page.getByText(/参加者 \(12\)/)).toBeVisible({ timeout: 15_000 });

    await dash.commitSeatingOnly();
    await expect(dash.tableCard(6)).toBeVisible({ timeout: 15_000 });

    // 6 卓存在で「卓を追加」は disabled。
    await expect(page.getByTestId("add-table")).toBeDisabled();
  });

  test("満席状態で late entry を追加すると未配席ガイドが表示される", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("guide");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Unseated Guide",
      seatsPerTable: 2,
    });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();

    // 名前のみ 4 名 → seatsPerTable=2 で 2 卓（満席）。
    for (const name of ["Pa", "Pb", "Pc", "Pd"]) {
      await addNamedGuest(page, name);
    }
    await expect(page.getByText(/参加者 \(4\)/)).toBeVisible({ timeout: 15_000 });

    await dash.commitSeatingOnly();
    await expect(dash.tableCard(2)).toBeVisible({ timeout: 15_000 });

    // commit 後（seating）は isAcceptingLateSeats=true。満席なので autoSeat は no-seat で
    // 未配席が残り、ガイドバナーが表示される。
    await addNamedGuest(page, "Zara");
    await expect(page.getByText(/参加者 \(5\)/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("unseated-guide")).toBeVisible({ timeout: 15_000 });
  });
});
