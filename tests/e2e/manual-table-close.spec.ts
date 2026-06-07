import { test, expect, type Page } from "./fixtures/test-context";
import { randomOrganizer, seedOrganizerTournament } from "./fixtures/flows";

/**
 * Phase 3 (07-third-dryrun-improvements): 手動卓閉鎖の observable な振る舞い。
 *
 * engine.planManualTableClose / orchestrator.applyManualTableClose / useTableClose /
 * CloseTableConfirmDialog / SeatingBoard の各層は unit / component test で網羅済み。
 * E2E では「SeatingBoard の『閉じる』↔ 確認ダイアログ ↔ Firestore 再配置」の
 * ラウンドトリップをユーザー観測点として固定する:
 *
 *   - seatsPerTable=2 で 5 名を代理受付 → commit seating で 3 卓（2/2/1）。
 *   - 最少人数の卓（1 名）を閉じると、その 1 名が残卓へ集約され、残卓は
 *     seatsPerTable=2 を一時的に超えて 3 名（席 3 を描画）になる。
 *   - 閉じた卓は「閉鎖」バッジになる。
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

test.describe("Phase 3: 手動卓閉鎖", () => {
  // 冷えた emulator + organizer 登録 + 5 名代理受付 + commit seating まで通すため拡張。
  test.describe.configure({ timeout: 120_000 });

  test("最少人数の卓を閉じると残卓へ集約され、seatsPerTable を超えて全員表示される", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("close-op");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Manual Close",
      seatsPerTable: 2,
    });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();

    // 名前のみ 5 名を代理受付（uid=null）。seatsPerTable=2 → ceil(5/2)=3 卓（2/2/1）。
    for (const name of ["Pa", "Pb", "Pc", "Pd", "Pe"]) {
      await addNamedGuest(page, name);
    }
    await expect(page.getByText(/参加者 \(5\)/)).toBeVisible({ timeout: 15_000 });

    // 席決め commit → seating 状態で 3 卓表示。
    await dash.commitSeatingOnly();
    await expect(dash.tableCard(1)).toBeVisible({ timeout: 15_000 });
    await expect(dash.tableCard(2)).toBeVisible({ timeout: 15_000 });
    await expect(dash.tableCard(3)).toBeVisible({ timeout: 15_000 });

    // 卓3 は 1 名（round-robin で必ず最少）。確認のため header を assert。
    await expect(dash.tableHeaderTitle(3)).toContainText("（1 人）");

    // 卓3 の「閉じる」→ 確認ダイアログ → 確定。
    await page.getByTestId("close-table-3").click();
    const confirm = page.getByTestId("close-table-confirm");
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    await confirm.click();

    // 閉鎖後: 卓3 は「閉鎖」バッジ + 0 人。閉じた 1 名は残卓（tie-break で卓1）へ集約され、
    // 卓1 が seatsPerTable=2 を超えて 3 人（席 3 を描画）になる。
    await expect(dash.tableCard(3).getByText("閉鎖")).toBeVisible({ timeout: 15_000 });
    await expect(dash.tableHeaderTitle(3)).toContainText("（0 人）");
    await expect(dash.tableHeaderTitle(1)).toContainText("（3 人）");
    // 定員引き上げの user-visible 根拠: 卓1 が 3 行（席 1/2/3）を描画する。
    await expect(dash.tableCard(1).getByRole("listitem")).toHaveCount(3);
  });

  /**
   * overflow ブロック: 残卓が定員 10 名/卓 でも収容できないとき、確認ダイアログで
   * 警告し confirm を無効化して tx を発行しない（卓は閉じない）。
   *
   * engine.planManualTableClose / CloseTableConfirmDialog は overflow 単体を unit /
   * component で網羅済み。ここでは「実 Firestore データの往復で needed/capacity が算出され、
   * confirm 無効 + 卓が閉じられない（mutation なし）」という統合点のみを E2E で固定する。
   *
   * なお only-one-table（最後の 1 卓）ブロックは SeatingBoard が生存卓 1 つのとき
   * 「閉じる」ボタン自体を出さない設計のため UI からは到達不能で、E2E 対象外
   * （SeatingBoard.test / CloseTableConfirmDialog.test / engine.test で網羅済み）。
   */
  test("残卓に収まらない卓は overflow 警告で閉鎖がブロックされ、卓は閉じない", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("close-of");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Overflow Close",
      seatsPerTable: 10,
    });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();

    // 名前のみ 11 名を代理受付。seatsPerTable=10 → ceil(11/10)=2 卓。
    // どちらの卓を閉じても残卓は 1 つ（capacity = 10 × 1 = 10 < active 11）で overflow。
    for (let i = 1; i <= 11; i++) {
      await addNamedGuest(page, `P${String(i).padStart(2, "0")}`);
    }
    await expect(page.getByText(/参加者 \(11\)/)).toBeVisible({ timeout: 15_000 });

    // 席決め commit → 2 卓表示。
    await dash.commitSeatingOnly();
    await expect(dash.tableCard(1)).toBeVisible({ timeout: 15_000 });
    await expect(dash.tableCard(2)).toBeVisible({ timeout: 15_000 });

    // 卓2 の「閉じる」→ 確認ダイアログ。残卓 1 つでは 11 名を収容できず overflow。
    await page.getByTestId("close-table-2").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // overflow 警告: 実データから needed=11 / capacity=10 が算出され description に反映。
    await expect(dialog.getByText(/残卓に収まりません/)).toBeVisible();
    await expect(dialog.getByText(/配置必要 11 名/)).toBeVisible();
    await expect(dialog.getByRole("alert")).toContainText("収まらないため閉鎖できません");

    // confirm は無効化され tx は発行されない。
    await expect(page.getByTestId("close-table-confirm")).toBeDisabled();

    // キャンセルしてダイアログを閉じる。
    await dialog.getByRole("button", { name: "キャンセル" }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // mutation 不発の確認: 両卓とも「閉鎖」バッジが付かず生存のまま。
    await expect(dash.tableCard(1).getByText("閉鎖")).toHaveCount(0);
    await expect(dash.tableCard(2).getByText("閉鎖")).toHaveCount(0);
    // 生存卓 2 つのままなので両卓に「閉じる」ボタンが出続ける。
    await expect(page.getByTestId("close-table-1")).toBeVisible();
    await expect(page.getByTestId("close-table-2")).toBeVisible();
  });
});
