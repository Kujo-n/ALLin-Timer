import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  Timestamp,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import {
  groupJoinCodeBodySchema,
  type CreateGroupJoinCodeInput,
  type GroupJoinCodeDoc,
} from "@/lib/firebase/schemas/groupJoinCode";
import { logger } from "@/lib/logger";

export const groupJoinCodesRef = collection(firestore, "groupJoinCodes").withConverter(
  zodConverter(groupJoinCodeBodySchema, "groupJoinCodes"),
);

export function joinCodeDocRef(code: string) {
  return doc(groupJoinCodesRef, code);
}

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 16;

/**
 * URL-safe な招待コード文字列を生成する。
 * `crypto.getRandomValues` ベースで 16 文字 (=~ 82bit のランダム性)。
 * 衝突は 20 人 × 月 1〜2 回スケールではまず発生しないが、
 * setDoc 衝突回避のため呼び出し側で `getJoinCode` 確認＋リトライする。
 */
export function generateCodeString(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  if (typeof crypto === "undefined" || !crypto.getRandomValues) {
    throw new AppError("crypto.getRandomValues が利用できません", "runtime/no-crypto");
  }
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    result += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return result;
}

/**
 * 招待コードを生成して Firestore に保存する。code 衝突は最大 3 回リトライ。
 */
export async function createJoinCode(input: CreateGroupJoinCodeInput): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCodeString();
    try {
      const existing = await getDoc(joinCodeDocRef(code));
      if (existing.exists()) continue;
      await setDoc(joinCodeDocRef(code), {
        gid: input.gid,
        createdByUid: input.createdByUid,
        expiresAt: input.expiresAt,
        maxUses: input.maxUses,
        usesCount: 0,
        createdAt: serverTimestamp(),
      });
      logger.info("join code create ok", { gid: input.gid, code });
      return code;
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "招待コード作成に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
      throw wrapped;
    }
  }
  throw new AppError("招待コードの生成に失敗しました（衝突が連続）", "firestore/write_failed");
}

export async function getJoinCode(code: string): Promise<GroupJoinCodeDoc | null> {
  try {
    const snap = await getDoc(joinCodeDocRef(code));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/read_failed", "招待コード取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

/**
 * 単独で usesCount を +1 する。トランザクション内で呼ぶときは使用しないこと
 * （`tx.update` で同等処理を書く）。
 */
export async function incrementUsesCount(code: string): Promise<void> {
  try {
    await updateDoc(joinCodeDocRef(code), { usesCount: increment(1) });
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "firestore/write_failed",
      "招待コードの使用回数更新に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

export async function deleteJoinCode(code: string): Promise<void> {
  try {
    await deleteDoc(joinCodeDocRef(code));
    logger.info("join code delete ok", { code });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "招待コード削除に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

/**
 * 期限と最大使用回数で招待コードが現在使えるかを判定する。
 * クライアント側の早期失敗用。最終防衛は Firestore Rules。
 */
export function isJoinCodeUsable(codeDoc: GroupJoinCodeDoc, now: Date = new Date()): boolean {
  if (codeDoc.expiresAt.toMillis() <= now.getTime()) return false;
  if (codeDoc.maxUses !== null && codeDoc.usesCount >= codeDoc.maxUses) {
    return false;
  }
  return true;
}

export function defaultExpiresAt(now: Date = new Date()): Timestamp {
  const ms = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  return Timestamp.fromDate(new Date(ms));
}
