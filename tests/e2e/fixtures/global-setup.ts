import { request } from "@playwright/test";

import { E2E_PROJECT_ID } from "./emulator";

/**
 * Playwright globalSetup: E2E が本番 Firebase に向かない事を起動前に検証する。
 *
 * チェック内容:
 *   1. Firebase Auth / Firestore emulator が 9099 / 8080 で listen している
 *   2. `NEXT_PUBLIC_FIREBASE_PROJECT_ID` が `allin-pokertimer-e2e` 以外を指していない
 *
 * 1 つでも失敗したら fail-fast で abort し、テストを 1 件も実行させない。
 * playwright.config.ts の webServer は通常 emulator + emulator-env を起動するが、
 * `--reuse-existing-server` で外部の next dev に相乗りした場合等、production env が
 * 紛れ込む経路が残るため、最終 gate として globalSetup で守る。
 */

const AUTH_EMULATOR_URL = "http://127.0.0.1:9099";
const FIRESTORE_EMULATOR_URL = "http://127.0.0.1:8080";

export default async function globalSetup(): Promise<void> {
  const ctx = await request.newContext();
  try {
    const [authRes, fsRes] = await Promise.all([
      ctx.get(AUTH_EMULATOR_URL, { timeout: 3000 }),
      ctx.get(FIRESTORE_EMULATOR_URL, { timeout: 3000 }),
    ]);
    if (!authRes.ok() || !fsRes.ok()) {
      throw new Error(
        `emulator が応答しません (auth=${authRes.status()} firestore=${fsRes.status()})`,
      );
    }
  } catch (e) {
    throw new Error(
      "Firebase Emulator が起動していません。E2E は emulator 経由必須です。\n" +
        "  → playwright.config.ts の webServer 経由で実行するか、別ターミナルで\n" +
        "    npm run emulator\n" +
        "  を起動してから再実行してください。\n" +
        `原因: ${(e as Error).message}`,
    );
  } finally {
    await ctx.dispose();
  }

  const pid = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (pid && pid !== E2E_PROJECT_ID) {
    throw new Error(
      `E2E は projectId=${E2E_PROJECT_ID} で走らせる必要があります。検出: ${pid}\n` +
        ".env.local の本番値が外部 next dev に流入していないか確認してください。",
    );
  }
}
