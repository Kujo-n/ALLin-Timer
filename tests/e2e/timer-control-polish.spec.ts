import { test, expect } from "./fixtures/test-context";
import { getDocument } from "./fixtures/emulator";
import { joinAsGuest, randomOrganizer, seedOrganizerTournament } from "./fixtures/flows";

/**
 * Phase 4.11: Timer Layout & Control Polish
 *
 * 実環境 (Firestore Emulator + 実 UI) でなければ再現が難しい 3 件:
 *   1. pause 中に「次レベル」を押した後で「再開」してもエラーが出ない
 *      （revertLevel/advanceLevel が pause 状態を維持して pausedAt を再アームする regression）
 *   2. 手動 advance/revert で `lastLevelChangeKind === "manual"` が Firestore に書き込まれる
 *      （useAudioPlayer がブラインドアップ音を抑制する判定の元データ）
 *      ※ headless Chromium で <audio>.play() は autoplay policy で reject されるため
 *         実音再生ではなく Firestore 上の field 書込みで検証する。
 *   3. トーナメント終了時にタイマー表示が `00:00` ではなく終了時点の残時間で固定される
 *      （getRemainingMs の finished 経路）
 */

interface FieldsRecord {
  fields?: Record<string, unknown>;
}

/** Firestore Emulator REST レスポンスから tournaments/{tid} 主要フィールドを抽出。 */
function readTournamentFields(doc: Record<string, unknown>): {
  state?: string;
  currentLevel?: number;
  lastLevelChangeKind?: string | null;
  finishedAtSet: boolean;
  pausedAtSet: boolean;
} {
  const fields = (doc as FieldsRecord).fields ?? {};
  const state = (fields.state as { stringValue?: string } | undefined)?.stringValue;
  // integerValue は string で来るので Number() で揃える。
  const lvRaw = (fields.currentLevel as { integerValue?: string } | undefined)?.integerValue;
  const currentLevel = lvRaw !== undefined ? Number(lvRaw) : undefined;
  const kindWrapper = fields.lastLevelChangeKind as
    | { stringValue?: string; nullValue?: null }
    | undefined;
  const lastLevelChangeKind = kindWrapper
    ? kindWrapper.stringValue !== undefined
      ? kindWrapper.stringValue
      : null
    : undefined;
  const finishedAt = fields.finishedAt as
    | { timestampValue?: string; nullValue?: null }
    | undefined;
  const finishedAtSet =
    finishedAt !== undefined && finishedAt.timestampValue !== undefined;
  const pausedAt = fields.pausedAt as
    | { timestampValue?: string; nullValue?: null }
    | undefined;
  const pausedAtSet = pausedAt !== undefined && pausedAt.timestampValue !== undefined;
  return { state, currentLevel, lastLevelChangeKind, finishedAtSet, pausedAtSet };
}

/** "MM:SS" または "H:MM:SS" を ms に変換。タイマー表示文字列の検算に使う。 */
function parseTimerToMs(text: string): number {
  const trimmed = text.trim();
  const parts = trimmed.split(":").map((s) => Number(s));
  if (parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`unparseable timer text: "${trimmed}"`);
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return (m * 60 + s) * 1000;
  }
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return ((h * 60 + m) * 60 + s) * 1000;
  }
  throw new Error(`unexpected timer format: "${trimmed}"`);
}

test.describe("Phase 4.11: timer control polish", () => {
  test("pause 中に次レベルを押した後でも再開するとエラーにならず running に戻る", async ({
    page,
    tournamentDashboardPage,
  }) => {
    // 2 名以上必要（1 名のみだと winner 自動 finish が走り検証中に state が finished に
    // 移ってしまう可能性がある）。ゲスト 1 名 + 運営者自己参加で計 2 名にする。
    const organizer = randomOrganizer("pp");
    const { tid } = await seedOrganizerTournament(page, { organizer });

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const guestCtx = await browser.newContext();
    try {
      const guestPage = await guestCtx.newPage();
      await joinAsGuest(guestPage, tid, "Guest1");
      await guestPage.close();
    } finally {
      await guestCtx.close();
    }

    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(2\)/)).toBeVisible({ timeout: 15_000 });

    await dash.startTournament();
    await expect(dash.stateBadge).toHaveText("進行中");

    // pause → 次レベル → 再開 の順に操作。各操作で state の遷移を待つ。
    await dash.pauseButton.click();
    await expect(dash.stateBadge).toHaveText("一時停止中", { timeout: 10_000 });

    // pause 状態のまま「次レベル」を押す。修正前は pausedAt: null が書かれて
    // resumeTournament が `tournament/invalid-state` で失敗していた。
    await dash.advanceButton.click();
    // currentLevel=2 で paused が維持されることを Firestore で確認する
    // （UI 上はバッジだけでは pausedAt の再アームを観測できないため）。
    await expect
      .poll(
        async () => {
          const snap = await getDocument(page.request, `tournaments/${tid}`);
          if (!snap.exists) return null;
          return readTournamentFields(snap.data!);
        },
        { timeout: 10_000 },
      )
      .toMatchObject({
        state: "paused",
        currentLevel: 2,
        pausedAtSet: true,
        lastLevelChangeKind: "manual",
      });

    // 再開 → エラーが出ず state=running になることを確認。
    await dash.resumeButton.click();
    await expect(dash.stateBadge).toHaveText("進行中", { timeout: 10_000 });
    // alert role は他のフローでも使われるが、resume 失敗時のみ表示される
    // `tournament/invalid-state: pausedAt が設定されていません` を含むかで判定する。
    await expect(dash.errorAlert.filter({ hasText: /invalid-state/ })).toHaveCount(0);
  });

  test("手動 advance / revert で lastLevelChangeKind=manual が Firestore に書き込まれる", async ({
    page,
    request,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("mk");
    const { tid } = await seedOrganizerTournament(page, { organizer });

    // ゲスト 1 名 + 運営者自己参加 で active=2 にし auto-finish を回避。
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const guestCtx = await browser.newContext();
    try {
      const guestPage = await guestCtx.newPage();
      await joinAsGuest(guestPage, tid, "Guest2");
      await guestPage.close();
    } finally {
      await guestCtx.close();
    }

    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(2\)/)).toBeVisible({ timeout: 15_000 });

    await dash.startTournament();
    await expect(dash.stateBadge).toHaveText("進行中");

    // confirmSeating 直後は lastLevelChangeKind は書かれない（schema コメントどおり）。
    // この場合 stringValue は undefined になり、最終的に "manual" に上書きされるかどうかを後段で見る。

    // 1. 手動 advance（次レベル）
    await dash.advanceButton.click();
    await expect
      .poll(
        async () => {
          const snap = await getDocument(request, `tournaments/${tid}`);
          if (!snap.exists) return null;
          return readTournamentFields(snap.data!);
        },
        { timeout: 10_000 },
      )
      .toMatchObject({
        currentLevel: 2,
        lastLevelChangeKind: "manual",
      });

    // 2. 手動 revert（前レベル）でも "manual" が記録される
    await dash.revertButton.click();
    await expect
      .poll(
        async () => {
          const snap = await getDocument(request, `tournaments/${tid}`);
          if (!snap.exists) return null;
          return readTournamentFields(snap.data!);
        },
        { timeout: 10_000 },
      )
      .toMatchObject({
        currentLevel: 1,
        lastLevelChangeKind: "manual",
      });
  });

  test("終了時にタイマーは 00:00 ではなく終了時点の残り時間で固定される", async ({
    page,
    tournamentDashboardPage,
  }) => {
    // 1 名のみで終了させる。auto-finish は active < 2 では発火しない（resolveWinner は
    // players.length >= 2 を要求するため、1 名でも winner 判定は走らない）。
    // 運営者自己参加だけで進める。
    const organizer = randomOrganizer("ff");
    const { tid } = await seedOrganizerTournament(page, { organizer });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({ timeout: 15_000 });

    await dash.startTournament();
    await expect(dash.stateBadge).toHaveText("進行中");

    // 開始から数秒待ってからタイマー表示を読み取り、これが finish 後に保持されるか確認する。
    // - default 構造の Lv1 は durationSec=600（10:00）
    // - 3 秒経過時点では 09:5x が見えるはず
    await page.waitForTimeout(3_000);
    const beforeFinishText = (await dash.remainingTime.textContent())?.trim() ?? "";
    const beforeMs = parseTimerToMs(beforeFinishText);
    // 「実際に経過観測ができている」ことを確認するため 9 分台であること（誤差許容）。
    expect(beforeMs).toBeGreaterThan(540_000); // > 9:00
    expect(beforeMs).toBeLessThan(600_000); // < 10:00 (must have ticked)

    await dash.clickFinishAndConfirm();
    await expect(dash.stateBadge).toHaveText("終了", { timeout: 10_000 });

    // finish 後にしばらく待っても 00:00 に落ちず、終了時点の残時間で止まること。
    // クライアント時計と finishedAt の serverTimestamp に若干のずれがあるため
    // 「9 分台で固定」をゆるく検証する（厳密一致は検証しない）。
    await page.waitForTimeout(2_000);
    const afterFinishText = (await dash.remainingTime.textContent())?.trim() ?? "";
    const afterMs = parseTimerToMs(afterFinishText);
    expect(afterFinishText).not.toBe("00:00");
    expect(afterMs).toBeGreaterThan(540_000);

    // さらに 1 秒待って再観測 — 値がカウントダウンしていない（fixed）こと。
    await page.waitForTimeout(1_000);
    const stableText = (await dash.remainingTime.textContent())?.trim() ?? "";
    expect(stableText).toBe(afterFinishText);
  });
});
