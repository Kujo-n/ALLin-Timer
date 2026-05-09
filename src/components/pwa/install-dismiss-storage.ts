import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * PWA install promotion / iOS install hint で共有する dismiss state の永続化 helper。
 *
 * Phase D の架空 architect-refactor (20260509) で `PwaInstallPromotion.tsx` /
 * `IOsInstallHint.tsx` から重複していた storage 5 シンボルを 1 module に集約。
 * storage key drift で「片方だけ書く / もう片方は読まない」事故を構造的に防ぐ。
 *
 * 設計上の不変条件:
 *   - 両 component は **同 storage key を共有する**ことで、Android Chrome 系で
 *     Promotion を dismiss した瞬間から iOS Safari Hint も 30 日 hide される連動を
 *     成立させる
 *   - SSR-safe（`typeof window === "undefined"` で early return）
 *   - storage 例外は logger.warn のみで silent。ユーザに見せない
 */

export const PWA_INSTALL_DISMISS_STORAGE_KEY = "allinpt.pwaInstallDismissedAt";

export const PWA_INSTALL_DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function readPwaInstallDismissedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PWA_INSTALL_DISMISS_STORAGE_KEY);
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "pwa/storage-failed",
      "インストール状態の読込に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code });
    return null;
  }
}

export function persistPwaInstallDismissedAt(ts: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PWA_INSTALL_DISMISS_STORAGE_KEY, String(ts));
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "pwa/storage-failed",
      "インストール状態の保存に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code });
  }
}

export function isWithinPwaInstallDismissTtl(at: number | null): boolean {
  if (at === null) return false;
  return Date.now() - at < PWA_INSTALL_DISMISS_TTL_MS;
}
