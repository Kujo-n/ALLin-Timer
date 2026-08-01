import { expect, test } from "./fixtures/test-context";
import { E2E_STORAGE_BUCKET, getDocument } from "./fixtures/emulator";
import {
  createGroup,
  randomOrganizer,
  registerOrganizer,
} from "./fixtures/flows";

/**
 * Phase A.3 (05-post-launch-polish Track A): 結果カード背景画像の通し検証。
 *
 * カバレッジ:
 *   1. OG route HTTP 層 — `/api/og/winner/[tid]?bgImageUrl=<自バケットの Storage URL>` で
 *      200 + image/png を返す（allowlist を通ったフェッチが失敗してもグラデ fallback
 *      で render が止まらないことの回帰検出）
 *   1'. 同 HTTP 層 — 他プロジェクトのバケットの URL は 400 で拒否される
 *      （architect-refactor 20260801 finding-2: allowlist は host に加えてバケット一致まで
 *       検査する。未認証 OG route が任意の公開 GCS オブジェクトの画像プロキシ化するのを防ぐ）
 *   2. UI 経路 — owner が settings タブを開き、ファイル入力に小さな PNG を流し込み、
 *      「保存」 → groups doc に `winnerCardBackground.imageUrl` が反映され、preview に
 *      画像が描画されることを確認
 *   3. Dialog 経路 — 「背景を解除」 → `<Dialog>` 出現 → 「キャンセル」 で何も起こらない、
 *      「背景を解除する」 で groups doc から imageUrl が消えることを確認
 *
 * Storage emulator が webServer から起動されているのが前提（playwright.config.ts）。
 * emulator URL はホスト allowlist に含まれないため、OG route で fetch されると
 * グラデ fallback に倒れる（= allowlist 防御の観測点）。
 */

/**
 * 最小サイズの 1×1 PNG（IHDR/IDAT/IEND 付きの valid PNG）。
 * client-side の resizeImageToCardSize は canvas.drawImage で 1200×630 に拡縮するため、
 * 小さな元画像でも upload 経由で valid な blob を生成できる。
 */
const TINY_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x04, 0x00,
  0x01, 0x27, 0x34, 0x27, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

/**
 * Firestore REST API レスポンスから winnerCardBackground.imageUrl を抽出する。
 * REST shape: `{ fields: { winnerCardBackground: { mapValue: { fields: { imageUrl: { stringValue } } } } } }`
 */
function readWinnerCardBgImageUrl(
  doc: Record<string, unknown>,
): string | null {
  const fields = (doc as { fields?: Record<string, unknown> }).fields ?? {};
  const bg = fields.winnerCardBackground as
    | { mapValue?: { fields?: Record<string, unknown> }; nullValue?: unknown }
    | undefined;
  if (!bg?.mapValue) return null;
  const inner = bg.mapValue.fields ?? {};
  const url = (inner.imageUrl as { stringValue?: string } | undefined)
    ?.stringValue;
  return typeof url === "string" && url.length > 0 ? url : null;
}

test.describe("Phase A.3: card background — readability layer & dialog", () => {
  /** winner OG route の共通クエリ（bgImageUrl 以外は固定）。 */
  function winnerQuery(bgImageUrl: string): string {
    return new URLSearchParams({
      winnerName: "Bob",
      tournamentName: "Sample",
      participants: "8",
      finishedAtLabel: "2026/5/12",
      filename: "winner-sample",
      bgImageUrl,
      bgTextTheme: "light",
    }).toString();
  }

  test("/api/og/winner/[tid] が bgImageUrl 経由でも 200 + image/png を返す（fetch 失敗 → グラデ fallback の回帰検出）", async ({
    request,
  }) => {
    // allowlist（host + バケット一致）は通過するが実体が存在しない URL を渡し、
    // fetchAsDataUri が AppError を throw → OG route がグラデ fallback で 200 を返すことを
    // assert する。allowlist 判定そのものの網羅は og-image-fetch.test.ts に分担し、
    // 本 E2E は「fetch 失敗で render が止まらない」ことの観測点に絞る。
    //
    // ⚠ バケットは E2E_STORAGE_BUCKET（= playwright.config.ts が dev server に注入する
    //   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET）と一致させる必要がある。
    //   architect-refactor 20260801 finding-2 で allowlist がバケット一致まで検査するように
    //   なったため、任意のバケット名だと fetch に到達する前に schema で 400 になる
    //   （= 本 test が検証したい「fetch 失敗」経路に入らない）。
    const unreachableUrl = `https://firebasestorage.googleapis.com/v0/b/${E2E_STORAGE_BUCKET}/o/missing.jpg?alt=media`;
    const res = await request.get(
      `/api/og/winner/dummy-tid?${winnerQuery(unreachableUrl)}`,
    );
    expect(res.status(), `body=${await res.text()}`).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    const body = await res.body();
    expect(body[0]).toBe(0x89);
    expect(body[1]).toBe(0x50);
    expect(body[2]).toBe(0x4e);
    expect(body[3]).toBe(0x47);
  });

  test("/api/og/winner/[tid] は他プロジェクトのバケットの bgImageUrl を 400 で拒否する", async ({
    request,
  }) => {
    // architect-refactor 20260801 finding-2: host allowlist だけでは
    // storage.googleapis.com / firebasestorage.googleapis.com が GCS 全体で共有される
    // マルチテナントホストのため、未認証の OG route が「任意の公開 GCS オブジェクトを
    // 取得して PNG に埋め込む汎用画像プロキシ」として第三者に利用できてしまう。
    // バケット一致検査が本番相当の env（bucket 設定済み）で効いていることを HTTP 層で確認する。
    for (const foreignUrl of [
      "https://firebasestorage.googleapis.com/v0/b/someone-else.appspot.com/o/x.jpg?alt=media",
      "https://storage.googleapis.com/someone-else-bucket/x.png",
    ]) {
      const res = await request.get(
        `/api/og/winner/dummy-tid?${winnerQuery(foreignUrl)}`,
      );
      expect(res.status(), `url=${foreignUrl} body=${await res.text()}`).toBe(400);
    }
  });

  test("owner が settings タブで背景画像を upload → groups doc に imageUrl が反映 + プレビューに img が出る", async ({
    page,
    request,
    groupDetailPage,
  }) => {
    const owner = randomOrganizer("bg-up");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "BG Upload Group");

    const detail = groupDetailPage(gid);
    await detail.goto();
    await detail.expectLoaded();
    await detail.selectTab("settings");

    // ファイル入力に PNG を流し込む（hidden input なので setInputFiles を直接使う）。
    const fileInput = page.getByTestId("winner-card-bg-file-input");
    await fileInput.setInputFiles({
      name: "sample.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });

    // 保存ボタンが有効化されるまで待つ（resize → blob 生成完了）。
    const saveButton = page.getByTestId("winner-card-bg-save");
    await expect(saveButton).toBeEnabled({ timeout: 15_000 });
    await saveButton.click();

    // 「保存しました」flash 表示で書込完了をマーク。
    await expect(page.getByText("保存しました")).toBeVisible({
      timeout: 30_000,
    });

    // groups doc に imageUrl が反映されたか REST 直読みで確認。
    const url = await expect
      .poll(
        async () => {
          const snap = await getDocument(request, `groups/${gid}`);
          if (!snap.exists) return null;
          return readWinnerCardBgImageUrl(snap.data!);
        },
        { timeout: 15_000 },
      )
      .toBeTruthy();
    void url; // 値そのものではなく存在を確認

    // preview 内に `<img>` が描画される（CardReadabilityPreview の hasImage 経路）。
    const previewImg = page
      .getByTestId("winner-card-bg-preview")
      .locator("img");
    await expect(previewImg).toHaveCount(1);
  });

  test("「背景を解除」 → Dialog 出現 → 「キャンセル」 で何も起こらない / 「背景を解除する」 で imageUrl が消える", async ({
    page,
    request,
    groupDetailPage,
  }) => {
    const owner = randomOrganizer("bg-cl");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "BG Clear Group");

    const detail = groupDetailPage(gid);
    await detail.goto();
    await detail.expectLoaded();
    await detail.selectTab("settings");

    // 事前 upload で imageUrl をセット。
    const fileInput = page.getByTestId("winner-card-bg-file-input");
    await fileInput.setInputFiles({
      name: "sample.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    const saveButton = page.getByTestId("winner-card-bg-save");
    await expect(saveButton).toBeEnabled({ timeout: 15_000 });
    await saveButton.click();
    await expect(page.getByText("保存しました")).toBeVisible({
      timeout: 30_000,
    });

    // 「背景を解除」 ボタン → Dialog 出現
    await page.getByTestId("winner-card-bg-clear").click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

    // 「キャンセル」 → Dialog 閉じる、imageUrl 維持
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^キャンセル$/ })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5_000 });

    const stillSet = await getDocument(request, `groups/${gid}`);
    expect(readWinnerCardBgImageUrl(stillSet.data!)).toBeTruthy();

    // 再度 「背景を解除」 → Dialog → 「背景を解除する」 → imageUrl が消える
    await page.getByTestId("winner-card-bg-clear").click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /背景を解除する/ })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });

    await expect
      .poll(
        async () => {
          const snap = await getDocument(request, `groups/${gid}`);
          return readWinnerCardBgImageUrl(snap.data!);
        },
        { timeout: 15_000 },
      )
      .toBeNull();
  });
});
