import { test, expect } from "./fixtures/test-context";
import { randomOrganizer, seedOrganizerTournament } from "./fixtures/flows";

/**
 * Phase B — Timer Offline Resilience の E2E カバレッジ。
 *
 * Phase B 実装の観測ポイント:
 *   1. `subscribeTournament({ includeMetadataChanges: true })` の `fromCache=true` を
 *      観測したとき、dashboard / live の最上段に
 *      `<OfflineBanner data-testid="offline-banner-disconnected">` が出る
 *   2. 初回 server snapshot 受信後にオンライン復帰すると `fromCache=false` になり
 *      banner が消える
 *
 * 検証対象（emulator + 実 Firestore SDK + 実 DOM が必要なため unit では再現不可）:
 *   - 通常の online 状態では disconnected banner が出ない
 *   - `context.setOffline(true)` で Firestore SDK が cache-only モードに遷移し
 *     dashboard 上で `offline-banner-disconnected` が表示される
 *   - `context.setOffline(false)` で接続が復帰し、banner が消える
 *
 * 検証外（既存 unit でカバー）:
 *   - OfflineBanner.test.tsx で 4 状態（online no-pending / online pending /
 *     offline / 両 true 時の disconnected 優先）を網羅済み
 *   - firestore-offline.test.ts で OFFLINE_FIRESTORE_ERROR_CODES の判定を網羅済み
 *   - tournaments.test.ts で advanceLevel(auto) tx → updateDoc fallback の
 *     5 ケース（offline-unavailable / deadline-exceeded / AppError 素通し /
 *     non-offline 再 throw / 二重失敗）を網羅済み
 *   - hasPendingWrites=true のときの「同期中…」blue banner は実 SDK で短時間しか
 *     出ず flaky なため E2E では扱わない
 *
 * NOTE: Firestore JS SDK は emulator 相手でも long-poll の heartbeat timeout が
 * ~30s 程度あり、`setOffline(true)` 直後に fromCache=true へ遷移するわけではない。
 * オフライン検出待ちは 60s タイムアウトを使う。
 */

test.describe("Phase B — Offline Banner", () => {
  test("dashboard: 通常表示では disconnected banner が出ない", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer();
    const { tid } = await seedOrganizerTournament(page, { organizer });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();

    // 初回 server snapshot 受信後 (= state badge が "開始前" を出した後) に
    // banner が出ていないことを確認する。useTournamentTimer の初期 state は
    // fromCache=true のため、初回 snapshot 着弾前に断定すると flaky。
    await expect(dash.stateBadge).toHaveText("開始前", { timeout: 15_000 });
    await expect(page.getByTestId("offline-banner-disconnected")).toHaveCount(0);
  });

  test("dashboard: setOffline(true) で disconnected banner が出て、復帰で消える", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer();
    const { tid } = await seedOrganizerTournament(page, { organizer });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();

    // 1. 初回 server snapshot を確実に受信する。これで Firestore SDK の watch stream
    //    が確立し、後続の setOffline → metadata change が走るルートに乗る。
    await expect(dash.stateBadge).toHaveText("開始前", { timeout: 15_000 });

    const banner = page.getByTestId("offline-banner-disconnected");
    await expect(banner).toHaveCount(0);

    // 2. オフラインに落とす。Firestore SDK は long-poll の heartbeat timeout で
    //    offline 検出するため数十秒かかる場合がある。banner 出現は 60s 待つ。
    await page.context().setOffline(true);
    await expect(banner).toBeVisible({ timeout: 60_000 });
    await expect(banner).toContainText("通信が一時切れています");

    // 3. オンライン復帰 — banner が消える
    await page.context().setOffline(false);
    await expect(banner).toHaveCount(0, { timeout: 60_000 });
  });
});
