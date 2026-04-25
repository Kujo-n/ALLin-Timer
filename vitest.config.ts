import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      // `text` reporter has a v8 sourcemap quirk that double-counts each source
      // file (one 100% row + one phantom 0% row), which corrupts the threshold
      // check below into reporting ~49% even though real coverage is ~98%.
      // Use `text-summary` for the totals; re-enable per-file with
      // `--coverage.reporter=text` on demand for local debugging.
      reporter: ["text-summary"],
      // ロジック層（src/lib 配下の .ts）のみ計測対象。React UI と Provider 系
      // glue は実 Firestore / DOM 環境を要するためカバレッジ対象外。
      include: ["src/lib/**/*.ts"],
      exclude: [
        "src/lib/**/*.test.ts",
        "src/lib/**/*.test.tsx",
        "src/lib/firebase/client.ts", // singleton 初期化（環境依存・テスト価値低）
        "src/lib/services/qr.ts", // qrcode.react の薄い再 export
        "src/lib/utils.ts", // cn() 1 行
        "src/lib/hooks/useTournamentTimer.ts", // React hook（@testing-library/react 未導入のためカバレッジ対象外）
        "src/lib/audio/audio-context.ts", // Web Audio API ラッパー（jsdom 非対応・singleton 初期化）
        // 以下は Firestore SDK の薄いラッパで、emulator 経由の integration test 領域。
        // unit test では mock のテストになり実価値が低いため対象外（tournaments.ts は
        // Phase 3 の transaction race / state 遷移ロジックを含むため対象に残す）。
        "src/lib/firebase/repositories/groupJoinCodes.ts",
        "src/lib/firebase/repositories/groups.ts",
        "src/lib/firebase/repositories/players.ts",
        "src/lib/firebase/repositories/structures.ts",
        "src/lib/firebase/repositories/users.ts",
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
