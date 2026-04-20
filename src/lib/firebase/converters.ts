import {
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type SnapshotOptions,
} from "firebase/firestore";
import type { ZodType } from "zod";

import { AppError } from "@/lib/errors";

/**
 * Firestore `withConverter` に渡す zod ベースのコンバーター。
 *
 * - schema はドキュメント本体（`id` を含まない）を validate する。
 * - `fromFirestore` 失敗時は `AppError("firestore/invalid-data")` を throw。
 * - 呼び出し側（repositories）で `{ id: snap.id, ...snap.data() }` のように `id` を合成する。
 *
 * `FirestoreDataConverter<T>`（単一型引数）を返すことで SDK の overload 制約を満たす。
 *
 * `serverTimestamps: "estimate"` を既定で指定し、`serverTimestamp()` の pending write 中でも
 * ローカル時刻で補完した Timestamp を返す。これがないと書き込み元クライアントの local snapshot は
 * 該当フィールドを一時的に `null` として受け取り、非 null な Timestamp schema の validate に失敗する。
 */
export function zodConverter<T extends DocumentData>(
  schema: ZodType<T>,
  collectionName: string,
): FirestoreDataConverter<T> {
  return {
    toFirestore(modelObject): DocumentData {
      return modelObject as DocumentData;
    },
    fromFirestore(snap: QueryDocumentSnapshot, options?: SnapshotOptions): T {
      const parsed = schema.safeParse(
        snap.data({ serverTimestamps: "estimate", ...options }),
      );
      if (!parsed.success) {
        throw new AppError(
          `Firestore document failed schema validation: ${collectionName}/${snap.id}`,
          "firestore/invalid-data",
          parsed.error,
        );
      }
      return parsed.data;
    },
  };
}
