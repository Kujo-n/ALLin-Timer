import path from "node:path";

import { test, expect } from "./fixtures/test-context";
import { randomOrganizer, registerOrganizer, createGroup, createDefaultStructure, createTournament } from "./fixtures/flows";

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
