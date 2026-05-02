import { test, expect } from "./fixtures/test-context";
import {
  joinAsGuest,
  randomOrganizer,
  seedOrganizerTournament,
} from "./fixtures/flows";

/**
 * Phase 5.1: PD（プレイングディーラー）モデルの観測可能挙動。
 *
 * 検証する振る舞い:
 *   - setup 状態で PlayerList の PD checkbox を ON にすると、commit seating 後に
 *     当該 player が **そのテーブルの seat 1** に配置される（engine.planInitialSeating
 *     の PD 先頭固定ロジックの user-visible 結果）
 *   - SeatingBoard 上で同卓に他 PD がいる席の checkbox は disabled（1 卓 1 PD UI ガード）
 *
 * 内部実装（pd.ts / engine.planInitialSeating の純関数仕様）は unit test で網羅済み。
 * ここではユーザー観測点のみ検証し、回帰の防壁とする。
 */

test.describe("Phase 5.1: Playing Dealer", () => {
  // 冷えた emulator + organizer 登録 + commit seating まで通すため default 30s を拡張。
  test.describe.configure({ timeout: 90_000 });

  test("setup で PD 指定したプレイヤーは席決め後に seat 1 へ配置される", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("pd-op");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      seatsPerTable: 9,
    });

    // organizer 自己参加 + ゲスト 1 名 = 2 名で 1 卓構成。
    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({
      timeout: 15_000,
    });

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const guestCtx = await browser.newContext();
    try {
      const guestPage = await guestCtx.newPage();
      await joinAsGuest(guestPage, tid, "PdGuest");
      await guestPage.close();

      await expect(page.getByText(/参加者 \(2\)/)).toBeVisible({
        timeout: 15_000,
      });

      // setup 中: organizer を PD として指定。PlayerList の PD checkbox を click。
      // `check()` は click 直後に checked=true を auto-verify するが、本 checkbox は
      // 完全に controlled で Firestore round-trip 後に値が反映されるため
      // `check()` だと "did not change its state" で失敗する。`click()` で fire-and-forget
      // して `toBeChecked()` で実際の伝播を待つ。
      const pdCheckbox = dash.pdCheckbox(organizer.displayName);
      await expect(pdCheckbox).toBeVisible();
      await pdCheckbox.click();
      await expect(pdCheckbox).toBeChecked({ timeout: 10_000 });

      // 席決め commit → seating 状態で止める（開始前に SeatingBoard を観測）。
      await dash.commitSeatingOnly();

      // SeatingBoard が 1 卓表示される。Card は role=region を持たないため属性 selector。
      const table1 = dash.tableCard(1);
      await expect(table1).toBeVisible({ timeout: 15_000 });

      // 卓内の seat li は <ul><li> 構造（implicit role=listitem）。
      // 1 番目の listitem が seat 1。先頭 prefix "1:" に organizer.displayName が並ぶ。
      const seats = table1.getByRole("listitem");
      // 全席（seatsPerTable=9）分 li が出る。
      await expect(seats).toHaveCount(9);
      const seat1 = seats.nth(0);
      await expect(seat1).toContainText("1:");
      await expect(seat1).toContainText(organizer.displayName);
      // PD バッジ ◎ が seat 1 の行に出ている（aria-label="pd-badge"）。
      await expect(seat1.getByLabel("pd-badge")).toBeVisible();
    } finally {
      await guestCtx.close();
    }
  });

  test("seating 後、同卓 PD 在席時に他席の checkbox は disabled", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("pd-lock");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      seatsPerTable: 9,
    });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({
      timeout: 15_000,
    });

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const guestCtx = await browser.newContext();
    try {
      const guestPage = await guestCtx.newPage();
      await joinAsGuest(guestPage, tid, "LockGuest");
      await guestPage.close();

      await expect(page.getByText(/参加者 \(2\)/)).toBeVisible({
        timeout: 15_000,
      });

      // setup で organizer を PD 指定 → commit seating（同卓 1 PD 確定）。
      // controlled checkbox のため click + toBeChecked パターンを使う（上テスト参照）。
      await dash.pdCheckbox(organizer.displayName).click();
      await expect(dash.pdCheckbox(organizer.displayName)).toBeChecked({
        timeout: 10_000,
      });
      await dash.commitSeatingOnly();

      // SeatingBoard 上、organizer の checkbox は ON（自席）、LockGuest の checkbox は disabled。
      // 1 卓 1 PD ガードが UI 側に効いている。
      const ownerSeatPd = dash.pdCheckbox(organizer.displayName);
      const guestSeatPd = dash.pdCheckbox("LockGuest");
      await expect(ownerSeatPd).toBeChecked();
      await expect(guestSeatPd).toBeDisabled();
    } finally {
      await guestCtx.close();
    }
  });
});
