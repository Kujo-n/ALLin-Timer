import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { firebaseStorage } from "@/lib/firebase/client";
import { AppError, getErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Phase A.2 (05-post-launch-polish Track A): 結果カード背景画像の Cloud Storage 入出力 repository。
 *
 * Storage SDK の直接呼出（`ref` / `uploadBytes` / `getDownloadURL` / `deleteObject`）は本 file に
 * 閉じ込め、UI / service 層からは export 関数のみを呼ぶ（Firestore repositories と同様の境界規約）。
 *
 * upload path は `groups/{gid}/bgImages/{assetId}` で固定する（`storage.rules` と完全一致）。
 *
 * AppError code:
 *   - `storage/upload-failed` — uploadBytes / getDownloadURL の失敗
 *   - `storage/delete-failed` — deleteObject の失敗（`object-not-found` を除く）
 */

export type CardImageContentType = "image/jpeg" | "image/png" | "image/webp";

function cardBackgroundPath(gid: string, assetId: string): string {
  return `groups/${gid}/bgImages/${assetId}`;
}

/**
 * 指定 path に blob を upload し、download URL を返す。
 *
 * `assetId` は呼出側（service 層）で `crypto.randomUUID()` を発行し、本関数は受け取るのみ。
 * Storage rule 側で `image/(jpeg|png|webp)` と 1MB 上限を強制しているため、ここでは
 * 例外ハンドリング以外の追加検証は行わない。
 */
export async function uploadCardBackgroundAsset(
  gid: string,
  assetId: string,
  blob: Blob,
  contentType: CardImageContentType,
): Promise<string> {
  const path = cardBackgroundPath(gid, assetId);
  const r = ref(firebaseStorage, path);
  try {
    await uploadBytes(r, blob, { contentType });
    const url = await getDownloadURL(r);
    logger.info("card background asset uploaded", {
      gid,
      assetId,
      contentType,
      bytes: blob.size,
    });
    return url;
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "storage/upload-failed",
      "結果カード背景画像のアップロードに失敗しました",
    );
    logger.warn(wrapped.message, {
      code: wrapped.code,
      origCode: getErrorCode(e),
      gid,
      assetId,
    });
    throw wrapped;
  }
}

/**
 * 指定 path の asset を削除する。`storage/object-not-found` は冪等扱い（既に消えていれば成功）。
 * それ以外の失敗は `AppError("storage/delete-failed")` で throw する。
 */
export async function deleteCardBackgroundAsset(
  gid: string,
  assetId: string,
): Promise<void> {
  const path = cardBackgroundPath(gid, assetId);
  const r = ref(firebaseStorage, path);
  try {
    await deleteObject(r);
    logger.info("card background asset deleted", { gid, assetId });
  } catch (e) {
    const origCode = getErrorCode(e);
    if (origCode === "storage/object-not-found") {
      logger.debug("card background asset already absent", { gid, assetId });
      return;
    }
    const wrapped = AppError.from(
      e,
      "storage/delete-failed",
      "結果カード背景画像の削除に失敗しました",
    );
    logger.warn(wrapped.message, {
      code: wrapped.code,
      origCode,
      gid,
      assetId,
    });
    throw wrapped;
  }
}
