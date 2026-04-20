import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      // ロジック層（src/lib 配下の .ts）のみ計測対象。React UI と Provider 系
      // glue は実 Firestore / DOM 環境を要するためカバレッジ対象外。
      include: ["src/lib/**/*.ts"],
      exclude: [
        "src/lib/**/*.test.ts",
        "src/lib/firebase/client.ts", // singleton 初期化（環境依存・テスト価値低）
        "src/lib/services/qr.ts", // qrcode.react の薄い再 export
        "src/lib/utils.ts", // cn() 1 行
        "src/lib/hooks/useTournamentTimer.ts", // React hook（@testing-library/react 未導入のためカバレッジ対象外）
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
