import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 4.5+ E2E 設定。
 *
 * 起動フロー:
 *   1. Firebase emulators (auth + firestore + ui) を起動
 *   2. Next.js dev server を `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true` で起動
 *   3. Playwright tests を実行
 *
 * 各 webServer は readiness 用 URL / port の応答を待ってから次へ進む。
 *
 * 注意:
 *  - Emulator は `allin-pokertimer-e2e` プロジェクト名で隔離（実プロジェクトと混ざらない）
 *  - Next.js は既定 3000 と衝突しないよう 3001 を使用
 *  - Emulator の Java 依存に注意（未インストールだと auth/firestore 起動が失敗）
 */
const E2E_PORT = 3001;
const E2E_PROJECT_ID = "allin-pokertimer-e2e";

const emulatorEnv: Record<string, string> = {
  NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "true",
  // Emulator は projectId を検証しないが、非空の値が必要。
  NEXT_PUBLIC_FIREBASE_API_KEY: "fake-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${E2E_PROJECT_ID}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: E2E_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${E2E_PROJECT_ID}.appspot.com`,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "0",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:0:web:fake",
  // note 公開記事リンク（トップ画面の TopPage PageObject 検証用）。
  // 本番 URL に依存せず e2e が pass するよう、明らかにテスト用と分かる dummy を注入。
  // 実 note ユーザに偶然衝突しないよう note.com 配下にはしない。
  NEXT_PUBLIC_NOTE_INTRO_ARTICLE_URL: "https://example.test/note-intro",
  NEXT_PUBLIC_NOTE_OPERATING_GUIDE_URL: "https://example.test/note-operating-guide",
};

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts/,
  // 本番 Firebase への流出予防 gate。emulator 未起動 or 非 e2e projectId 検出で
  // 全 spec を実行前に abort する（[tests/e2e/fixtures/global-setup.ts]）。
  globalSetup: "./tests/e2e/fixtures/global-setup.ts",
  fullyParallel: false, // Firestore state 共有のため並列 off（worker=1 と併用）
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // Firebase Emulator: auth / firestore / storage / ui を同時起動。
      // `--project` で隔離された名前空間を使う。
      // Phase A.3: storage を追加（結果カード背景画像 E2E の upload 経路で必要）。
      command: `firebase emulators:start --only auth,firestore,storage,ui --project ${E2E_PROJECT_ID}`,
      // Emulator UI (port 4000) の起動を readiness の目印にする。
      url: "http://127.0.0.1:4000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `next dev -p ${E2E_PORT}`,
      url: `http://127.0.0.1:${E2E_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: emulatorEnv,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
