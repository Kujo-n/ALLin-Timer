import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Track D Phase D.1: theme preference の localStorage 永続化 helper。
 *
 *   - 真実源: `localStorage["allinpt.theme"]`（個人 preference / デバイスごとに独立）
 *   - SSR-safe（`typeof window === "undefined"` で early return）
 *   - storage 例外は logger.warn のみで silent（メイン flow を止めない）
 *
 * Mirror: `src/components/pwa/install-dismiss-storage.ts` の storage helper パターン
 */

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "allinpt.theme";

const VALID_VALUES: readonly ThemePreference[] = ["light", "dark", "system"] as const;

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (VALID_VALUES as readonly string[]).includes(value);
}

export function readTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === null) return "system";
    if (isThemePreference(raw)) return raw;
    logger.warn("theme storage value invalid", {
      code: "theme/invalid-value",
      raw,
    });
    return "system";
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "theme/storage-failed",
      "テーマ設定の読込に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code });
    return "system";
  }
}

export function writeTheme(value: ThemePreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "theme/storage-failed",
      "テーマ設定の保存に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code });
  }
}
