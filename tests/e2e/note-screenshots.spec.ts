import path from "node:path";

import { test, expect } from "./fixtures/test-context";
import {
  randomOrganizer,
  registerOrganizer,
  createGroup,
  createDefaultStructure,
  createTournament,
  joinAsGuest,
  seedOrganizerTournament,
} from "./fixtures/flows";

/**
 * note 記事用のスクリーンショット生成スペック。
 *
 * - `CAPTURE_SCREENSHOTS=1` を渡したときだけ実行（通常の test:e2e では skip）
 * - 出力先: `docs/article/images/`
 *
 * 走らせ方:
 *   $ CAPTURE_SCREENSHOTS=1 npx playwright test note-screenshots.spec.ts
 */

const OUT_DIR = path.resolve(__dirname, "../../docs/article/images");
const VIEWPORT = { width: 1440, height: 900 };

test.skip(!process.env.CAPTURE_SCREENSHOTS, "CAPTURE_SCREENSHOTS not set");

test.describe.configure({ mode: "serial" });

async function shot(page: import("@playwright/test").Page, name: string) {
  await page.setViewportSize(VIEWPORT);
  // Firestore onSnapshot の流入を少し待つ。実描画が安定したらキャプチャ。
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(OUT_DIR, name),
    fullPage: true,
    animations: "disabled",
  });
}

test("note 用キャプチャ: 全画面通し撮影", async ({ page }) => {
  test.setTimeout(180_000);

  // 1. 未ログインのトップページ
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ALLin-PokerTimer" })).toBeVisible();
  await shot(page, "01-top-signed-out.png");

  // 2. ログイン / 新規登録フォーム
  await page.goto("/login");
  await page.getByRole("tab", { name: "新規登録" }).click();
  await expect(page.getByLabel("表示名")).toBeVisible();
  await shot(page, "02-login.png");

  // 3. 運営者として登録
  const organizer = randomOrganizer("note");
  await registerOrganizer(page, organizer);

  // 4. 登録後のトップページ
  await page.goto("/");
  await expect(page.getByRole("button", { name: "サークル一覧へ" })).toBeVisible();
  await shot(page, "03-top-signed-in.png");

  // 5. サークル新規作成フォーム
  await page.goto("/groups/new");
  await page.getByLabel("サークル名").fill("ALLin サークル例");
  await shot(page, "04-group-new.png");

  // 6. サークル作成 → 詳細
  const gid = await createGroup(page, "ALLin サークル例");
  await page.goto(`/groups/${gid}`);
  await expect(page.getByRole("button", { name: "招待コードを発行" })).toBeVisible();
  await shot(page, "05-group-detail.png");

  // 7. ストラクチャを default で作成（裏で使う）
  await createDefaultStructure(page, "Friday Night Default");

  // 8. トーナメント新規作成フォーム
  await page.goto("/tournaments/new");
  await page.getByLabel("トーナメント名").fill("ALLin Friday #001");
  await shot(page, "06-tournament-new.png");

  // 9. トーナメントを作成 → ダッシュボード（setup）
  const tid = await createTournament(page, "ALLin Friday #001", 9);
  await page.goto(`/tournaments/${tid}`);
  await expect(page.getByText("開始前")).toBeVisible({ timeout: 15_000 });

  // 受付者ゼロだと右列カードが skip されるため自分も参加して 1 名作る。
  await page.getByRole("button", { name: /自分も参加する/ }).click();
  await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({ timeout: 15_000 });
  await shot(page, "07-dashboard-setup.png");

  // 10. 席を決定 → 開始 → 進行中ダッシュボード
  await page.getByRole("button", { name: /席を決定/ }).click();
  await expect(page.getByRole("button", { name: /トーナメント開始/ })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: /トーナメント開始/ }).click();
  await expect(page.getByText("進行中")).toBeVisible({ timeout: 15_000 });
  // タイマーが 1 秒程度進んでから撮影（残り時間が default 値で固まってないことを示す）。
  await page.waitForTimeout(1500);
  await shot(page, "08-dashboard-running.png");

  // 11. ライブビュー（参加者画面の見え方）
  await page.goto(`/tournaments/${tid}/live`);
  await expect(page.getByText(/^(進行中|一時停止中)$/)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  await shot(page, "09-live.png");
});

test("note 用キャプチャ: 新機能フロー（PD / Table 名 / 結果カード / Clone / Season / アカウント削除）", async ({
  page,
  tournamentDashboardPage,
}) => {
  test.setTimeout(240_000);

  // 1 通し目とは別の運営者・別 group で進めて副作用を分離。
  const organizer = randomOrganizer("note2");
  const { gid, tid } = await seedOrganizerTournament(page, {
    organizer,
    groupName: "ALLin サークル例 2",
    structureName: "Note Default 2",
    tournamentName: "Note Sample #1",
    seatsPerTable: 4,
  });

  // ゲスト 2 名を別 context で受付（auto-finish のために 3 名構成を作る）。
  const browser = page.context().browser();
  if (!browser) throw new Error("browser unavailable");
  const guestContexts = [await browser.newContext(), await browser.newContext()];
  try {
    for (const [idx, ctx] of guestContexts.entries()) {
      const guestPage = await ctx.newPage();
      await joinAsGuest(guestPage, tid, idx === 0 ? "ゲストA" : "ゲストB");
      await guestPage.close();
    }
  } finally {
    for (const ctx of guestContexts) await ctx.close();
  }

  const dash = tournamentDashboardPage(tid);
  await dash.goto();
  // PD checkbox は PlayerList 上の自分の行に出るため、organizer も self-join する。
  await dash.selfJoinButton.click();
  await expect(page.getByText(/参加者 \(3\)/)).toBeVisible({ timeout: 15_000 });

  // 10. setup の PlayerList で PD ON した状態。記事の「PD（プレイングディーラー）」用。
  const pdBox = dash.pdCheckbox(organizer.displayName);
  await expect(pdBox).toBeVisible();
  await pdBox.click();
  await expect(pdBox).toBeChecked({ timeout: 10_000 });
  await shot(page, "10-pd-checkbox.png");

  // 11. seating 状態の SeatingBoard に Table label を編集して反映した状態。記事の「赤卓 / 青卓」用。
  await dash.commitSeatingOnly();
  await dash.editTableLabel(1, "赤卓");
  await expect(dash.tableHeaderTitle(1)).toContainText("赤卓", { timeout: 10_000 });
  await shot(page, "11-table-label.png");

  // 12. running → 2 名 bust → auto-finish で Winner banner + 結果カード DL ボタン。
  await dash.startButton.click();
  await expect(dash.stateBadge).toHaveText("進行中", { timeout: 15_000 });
  await dash.bustPlayer("ゲストA");
  await dash.bustPlayer("ゲストB");
  await expect(dash.stateBadge).toHaveText("終了", { timeout: 15_000 });
  await expect(dash.winnerBanner).toBeVisible({ timeout: 10_000 });
  await page
    .getByTestId("winner-card-download")
    .waitFor({ state: "visible", timeout: 5_000 });
  await shot(page, "12-winner-card.png");

  // 13. /tournaments/[tid]/clone — 「同じ参加者で次のトーナメント」参加者選択画面。
  const cloneLink = page.getByRole("link", {
    name: "同じ参加者で次のトーナメントを作成",
  });
  await expect(cloneLink).toBeVisible({ timeout: 10_000 });
  await Promise.all([
    page.waitForURL(`**/tournaments/${tid}/clone`, { timeout: 15_000 }),
    cloneLink.click(),
  ]);
  await expect(
    page.getByRole("heading", { name: "同じ参加者で次のトーナメントを作成" }),
  ).toBeVisible({ timeout: 10_000 });
  await shot(page, "13-clone-checklist.png");

  // 14. /groups/[gid]/season — シーズンランキング画面。finishTournament の seasonStats 反映後。
  await page.goto(`/groups/${gid}/season`);
  await expect(
    page.getByRole("heading", { name: "シーズンランキング" }),
  ).toBeVisible({ timeout: 15_000 });
  // seasonStats の onSnapshot 着信を少し待つ（最初の render は空配列の可能性）。
  await page.waitForTimeout(1500);
  await shot(page, "14-season-ranking.png");

  // 15. /settings — アカウント自己削除セクションが見える状態（ボタン押下はしない）。
  await page.goto("/settings");
  await expect(
    page.getByRole("button", { name: "アカウントを削除する" }),
  ).toBeVisible({ timeout: 10_000 });
  await shot(page, "15-account-delete.png");
});
