import { getErrorCode } from "@/lib/errors";
import {
  type CardImageContentType,
  deleteCardBackgroundAsset,
  uploadCardBackgroundAsset,
} from "@/lib/firebase/repositories/cardBackgroundStorage";
import type { CardBackground, CardTextTheme } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";
import { deleteWithRetry } from "@/lib/utils/retry";

import { setSeasonCardBackground, setWinnerCardBackground } from "./group";

/**
 * Phase A.2 (05-post-launch-polish Track A): 結果カード背景の upload / clear /
 * theme 変更を一括でオーケストレートする service。
 *
 * 役割分担:
 *   - Storage SDK 直接呼出は `cardBackgroundStorage` repository
 *   - owner-only の最終ガードと Firestore pointer 更新は `setWinnerCardBackground` /
 *     `setSeasonCardBackground`（A.1 service）
 *   - 本 service は「upload → Firestore pointer 更新 → 旧 asset retry 削除」の順序保証と、
 *     theme-only 更新（image を再 upload しない）の dispatch を持つ
 *
 * Phase A architect-refactor (T1): winner/season で対称な 6 関数を 3 internal helper に集約し、
 * export 関数は kind 差分の thin wrapper として残す（API 互換維持）。
 *
 * 設計上の race / orphan の扱い:
 *   - Storage upload 失敗時は Firestore 未更新で throw → 新 orphan は残らない（成功時のみ pointer 更新）
 *   - upload 成功 → Firestore 更新失敗（rule 違反等）は新 asset が orphan として残る。
 *     A.2 では UI のエラー再試行に倒し、自動 rollback は行わない（PRD scope 外）
 *   - 旧 asset 削除は `deleteWithRetry` で最大 3 回試行し、最終失敗は warn のみで握りつぶす
 *     ことで「Firestore pointer は新 asset を指している」状態を維持する
 */

type CardBackgroundKind = "winner" | "season";

const RETRY_OPTIONS = {
  attempts: 3,
  backoffMs: [200, 600] as const,
};

interface UploadAndSetParams {
  gid: string;
  uid: string;
  blob: Blob;
  contentType: CardImageContentType;
  textTheme: CardTextTheme;
  /** 直前の Firestore pointer の `storageAssetId`（null なら初回 upload）。 */
  previousAssetId: string | null;
}

interface ClearParams {
  gid: string;
  uid: string;
  /** 直前の Firestore pointer の `storageAssetId`（null なら Storage 削除は不要）。 */
  previousAssetId: string | null;
}

interface UpdateTextThemeParams {
  gid: string;
  uid: string;
  /** 現在の Firestore pointer（`imageUrl` / `storageAssetId` を保ったまま textTheme のみ差し替える）。 */
  current: NonNullable<CardBackground>;
  textTheme: CardTextTheme;
}

function kindSetter(kind: CardBackgroundKind) {
  return kind === "winner" ? setWinnerCardBackground : setSeasonCardBackground;
}

function logOrphanWarn(kind: CardBackgroundKind, gid: string, assetId: string) {
  return (e: unknown) =>
    logger.warn("orphan card background asset", {
      kind,
      gid,
      assetId,
      code: getErrorCode(e),
    });
}

async function retryDeletePrevious(
  kind: CardBackgroundKind,
  gid: string,
  previousAssetId: string | null,
): Promise<void> {
  if (previousAssetId === null) return;
  await deleteWithRetry(
    () => deleteCardBackgroundAsset(gid, previousAssetId),
    {
      ...RETRY_OPTIONS,
      onFinalFailure: logOrphanWarn(kind, gid, previousAssetId),
    },
  );
}

async function uploadAndSetCardBackground(
  kind: CardBackgroundKind,
  opts: UploadAndSetParams,
): Promise<void> {
  const assetId = crypto.randomUUID();
  const imageUrl = await uploadCardBackgroundAsset(
    opts.gid,
    assetId,
    opts.blob,
    opts.contentType,
  );
  await kindSetter(kind)({
    gid: opts.gid,
    uid: opts.uid,
    value: { imageUrl, storageAssetId: assetId, textTheme: opts.textTheme },
  });
  await retryDeletePrevious(kind, opts.gid, opts.previousAssetId);
}

async function clearCardBackground(
  kind: CardBackgroundKind,
  opts: ClearParams,
): Promise<void> {
  await kindSetter(kind)({
    gid: opts.gid,
    uid: opts.uid,
    value: null,
  });
  await retryDeletePrevious(kind, opts.gid, opts.previousAssetId);
}

async function updateCardBackgroundTextTheme(
  kind: CardBackgroundKind,
  opts: UpdateTextThemeParams,
): Promise<void> {
  await kindSetter(kind)({
    gid: opts.gid,
    uid: opts.uid,
    value: { ...opts.current, textTheme: opts.textTheme },
  });
}

/** winner カード背景の upload + pointer 更新 + 旧 asset 削除（retry）。 */
export function uploadAndSetWinnerCardBackground(
  opts: UploadAndSetParams,
): Promise<void> {
  return uploadAndSetCardBackground("winner", opts);
}

/** season カード背景の upload + pointer 更新 + 旧 asset 削除（retry）。 */
export function uploadAndSetSeasonCardBackground(
  opts: UploadAndSetParams,
): Promise<void> {
  return uploadAndSetCardBackground("season", opts);
}

/** winner カード背景を解除（pointer を null 化し、旧 asset を retry 削除）。 */
export function clearWinnerCardBackground(opts: ClearParams): Promise<void> {
  return clearCardBackground("winner", opts);
}

/** season カード背景を解除。 */
export function clearSeasonCardBackground(opts: ClearParams): Promise<void> {
  return clearCardBackground("season", opts);
}

/**
 * winner カードのテキストテーマのみ差し替え（画像 / assetId は据え置き）。
 * UI 側で「current が非 null かつ画像保持中」のときのみ呼ぶこと。
 */
export function updateWinnerCardBackgroundTextTheme(
  opts: UpdateTextThemeParams,
): Promise<void> {
  return updateCardBackgroundTextTheme("winner", opts);
}

/** season カードのテキストテーマのみ差し替え。 */
export function updateSeasonCardBackgroundTextTheme(
  opts: UpdateTextThemeParams,
): Promise<void> {
  return updateCardBackgroundTextTheme("season", opts);
}
