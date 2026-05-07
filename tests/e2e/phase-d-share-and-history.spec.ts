import { expect, test } from "./fixtures/test-context";
import {
  joinAsGuest,
  randomOrganizer,
  registerOrganizer,
  createGroup,
  seedOrganizerTournament,
} from "./fixtures/flows";

/**
 * Phase D follow-up: OG image route (`/api/og/winner/[tid]` / `/api/og/season/[gid]`) が
 * 200 + image/png + Content-Disposition: attachment を返すかを HTTP layer で直接検証。
 *
 *  - Vercel 本番で発生した「`<a download>` クリック → 『サイトを利用できませんでした』」
 *    と「シェアボタン押下 → fetch 500」の両症状の回帰検出器。
 *  - 根本原因は serverless function の bundle に WOFF が含まれず font load 失敗 → 500。
 *    本 spec で 200 + image/png を assert することで、`outputFileTracingIncludes` が
 *    抜けた / フォント読込 path が動的化された等の regression を即検出する。
 *  - dev / production server 双方で同条件で動作するため、CI / 本番デプロイ前検証の両方で有効。
 */
test.describe("Phase D follow-up: OG image route HTTP", () => {
  test("/api/og/winner/[tid] が 200 + image/png + attachment を返す", async ({
    request,
  }) => {
    const sp = new URLSearchParams({
      winnerName: "Bob",
      tournamentName: "Sample",
      participants: "8",
      finishedAtLabel: "2026/5/7",
      filename: "winner-sample-2026-05-07",
    });
    const res = await request.get(`/api/og/winner/dummy-tid?${sp.toString()}`);
    expect(res.status(), `body=${await res.text()}`).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const body = await res.body();
    // PNG magic header (89 50 4E 47 0D 0A 1A 0A) — render に成功した最低条件
    expect(body.byteLength).toBeGreaterThan(1024);
    expect(body[0]).toBe(0x89);
    expect(body[1]).toBe(0x50);
    expect(body[2]).toBe(0x4e);
    expect(body[3]).toBe(0x47);
  });

  test("/api/og/season/[gid] が 200 + image/png + attachment を返す", async ({
    request,
  }) => {
    const sp = new URLSearchParams({
      groupName: "Sample サークル",
      seasonStartDateLabel: "2026/4/1",
      top1Name: "Bob",
      top1Points: "120.5",
      top2Name: "Alice",
      top2Points: "80.25",
      filename: "season-sample-2026-05-07",
    });
    const res = await request.get(`/api/og/season/dummy-gid?${sp.toString()}`);
    expect(res.status(), `body=${await res.text()}`).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const body = await res.body();
    expect(body.byteLength).toBeGreaterThan(1024);
    expect(body[0]).toBe(0x89);
    expect(body[1]).toBe(0x50);
  });
});

/**
 * Phase D — Web Share API & Season History Polish
 *
 * カバレッジ:
 *  1. Winner エリアでダウンロードボタンが描画され、Chromium では ShareCardButton は
 *     null (canShare === false) のため render されない（並列配置の片側のみ可視）
 *  2. 履歴 0 件の `/groups/[gid]/season` 画面では「過去シーズン」セクションが
 *     描画されない（条件付き render の境界条件）
 *  3. トーナメント終了 → サークル詳細から「シーズンを開始する」 → 過去シーズン
 *     accordion が 1 件表示され、展開で top1 が見える（Phase A `seasonHistory`
 *     append-only + Phase D 閲覧 UI の通し動作）
 *
 *  NOTE: Web Share API は Chromium headless で `navigator.canShare({files})` が
 *  false を返すため、本 spec では「シェアボタンが出ないこと」のみ assert する。
 *  iOS Safari / Android Chrome の実機検証は Manual Validation で実施する。
 */

test.describe("Phase D: シェアボタン render gating", () => {
  test("Winner エリアでダウンロードのみ表示 / Chromium ではシェアボタン null", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer();
    const { tid } = await seedOrganizerTournament(page, { organizer });

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const guestContexts = await Promise.all([
      browser.newContext(),
      browser.newContext(),
    ]);
    try {
      await joinAsGuest(await guestContexts[0].newPage(), tid, "Alice");
      await joinAsGuest(await guestContexts[1].newPage(), tid, "Bob");

      const dash = tournamentDashboardPage(tid);
      await dash.goto();
      await expect(page.getByText(/参加者 \(2\)/)).toBeVisible({ timeout: 15_000 });

      await dash.startTournament();
      await dash.bustPlayer("Alice");

      // Winner banner と並列ボタン群が render されるまで待つ
      await expect(dash.winnerBanner).toBeVisible({ timeout: 10_000 });

      // download ボタン（Phase B から温存）は必ず表示
      await expect(page.getByTestId("winner-card-download")).toBeVisible({
        timeout: 5_000,
      });

      // share ボタン（Phase D 追加）は Chromium で canShare({files}) が false の
      // ため null render される（DOM に存在しない）。
      // 念のため render 落ち着くまで少し待つ（useEffect → setState の 1 tick 確定後）。
      await page
        .getByTestId("winner-card-download")
        .waitFor({ state: "visible" });
      await expect(page.getByTestId("winner-card-share")).toHaveCount(0);
    } finally {
      for (const ctx of guestContexts) await ctx.close();
    }
  });
});

test.describe("Phase D: シーズン履歴 accordion", () => {
  test("履歴 0 件のとき『過去シーズン』セクションは描画されない", async ({ page }) => {
    const organizer = randomOrganizer();
    await registerOrganizer(page, organizer);
    const gid = await createGroup(page, "E2E 履歴 0 件");

    await page.goto(`/groups/${gid}/season`);

    // 「このシーズンの戦績はまだありません」が出るまで待つ（subscribeSeasonStats
    // が 0 件で fire するか、stats=[] の初期 render どちらかで到達）。
    await expect(
      page.getByText("このシーズンの戦績はまだありません。"),
    ).toBeVisible({ timeout: 15_000 });

    // SeasonHistoryList の「読込中」もしくは結果 render が落ち着くまで待つ。
    // 0 件のときは section ごと null になる契約。
    await expect(
      page.getByText("過去シーズンを読込中…"),
    ).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId("season-history-section")).toHaveCount(0);
  });

  test(
    "シーズン切替後、過去シーズン accordion が 1 件表示され、展開で top1 が見える",
    async ({ page, tournamentDashboardPage }) => {
      const organizer = randomOrganizer();
      const { gid, tid } = await seedOrganizerTournament(page, { organizer });

      // 参加者 2 名を用意して 1 名バスト → auto-finish で seasonStats 更新
      const browser = page.context().browser();
      if (!browser) throw new Error("browser unavailable");
      const guestContexts = await Promise.all([
        browser.newContext(),
        browser.newContext(),
      ]);
      try {
        await joinAsGuest(await guestContexts[0].newPage(), tid, "Alice");
        await joinAsGuest(await guestContexts[1].newPage(), tid, "Bob");

        const dash = tournamentDashboardPage(tid);
        await dash.goto();
        await expect(page.getByText(/参加者 \(2\)/)).toBeVisible({
          timeout: 15_000,
        });
        await dash.startTournament();
        await dash.bustPlayer("Alice");

        // auto-finish 経由で finishTournament tx commit (seasonStats 加算含む)
        await expect(dash.stateBadge).toHaveText("終了", { timeout: 15_000 });

        // ---------- サークル詳細 → 「シーズンを開始する」 ----------
        await page.goto(`/groups/${gid}`);
        // SeasonCard が render されたら開始ボタン押下
        const startSeasonButton = page.getByRole("button", {
          name: /^シーズンを開始する$/,
        });
        await expect(startSeasonButton).toBeVisible({ timeout: 15_000 });
        await startSeasonButton.click();

        // 確認 Dialog
        await expect(
          page.getByRole("heading", { name: "シーズンを開始しますか？" }),
        ).toBeVisible({ timeout: 10_000 });
        await page
          .getByRole("dialog")
          .getByRole("button", { name: /^開始する$/ })
          .click();

        // dialog がクローズされ、SeasonCard の「現在シーズン開始」表示が
        // 「未設定」から実日付に変わるまで待つ（serverTimestamp の反映）。
        await expect(page.getByRole("dialog")).toHaveCount(0, {
          timeout: 15_000,
        });

        // ---------- 過去シーズンランキング画面で履歴 accordion 検証 ----------
        await page.goto(`/groups/${gid}/season`);

        const section = page.getByTestId("season-history-section");
        await expect(section).toBeVisible({ timeout: 15_000 });
        await expect(
          page.getByRole("heading", { name: "過去シーズン" }),
        ).toBeVisible();

        // accordion 行は 1 件。trigger button のテキストに首位（Bob = bust されなかった残り）が含まれる
        const items = page.locator(
          '[data-testid^="season-history-item-"]',
        );
        await expect(items).toHaveCount(1);
        await expect(items.first()).toContainText("首位: Bob");

        // 展開すると top3 (このケースは Alice + Bob = top2 のみ) が見える。
        // 折り畳まれた状態では Alice は表示されない（首位行に Bob のみ書いてある）
        await expect(
          section.getByRole("listitem", { name: /Alice/ }),
        ).toHaveCount(0);

        const toggle = page.locator(
          '[data-testid^="season-history-toggle-"]',
        );
        await toggle.first().click();

        // 展開後は <ol> 内の <li> として Alice / Bob が並ぶ
        await expect(section.getByText(/Bob —/)).toBeVisible();
        await expect(section.getByText(/Alice —/)).toBeVisible();
      } finally {
        for (const ctx of guestContexts) await ctx.close();
      }
    },
  );
});
