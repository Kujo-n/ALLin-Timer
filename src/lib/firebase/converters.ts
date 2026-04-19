import {
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
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
 */
export function zodConverter<T extends DocumentData>(
  schema: ZodType<T>,
  collectionName: string,
): FirestoreDataConverter<T> {
  return {
    toFirestore(modelObject): DocumentData {
      return modelObject as DocumentData;
    },
    fromFirestore(snap: QueryDocumentSnapshot): T {
      const parsed = schema.safeParse(snap.data());
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
