import { describe, expect, it } from "vitest";

import {
  OFFLINE_FIRESTORE_ERROR_CODES,
  isOfflineFirestoreErrorCode,
} from "./firestore-offline";

describe("isOfflineFirestoreErrorCode", () => {
  it.each(OFFLINE_FIRESTORE_ERROR_CODES)(
    "returns true for offline code %s",
    (code) => {
      expect(isOfflineFirestoreErrorCode(code)).toBe(true);
    },
  );

  it.each([
    "permission-denied",
    "not-found",
    "failed-precondition",
    "invalid-argument",
    "already-exists",
    // `aborted` は runTransaction の SDK 内部 retry を尽くした後に surface する tx contention であり、
    // local cached view が古い可能性が高い。fallback で stale な currentLevel を信じて updateDoc を
    // 投げると二重 advance race を生むため、明示的に non-offline 扱い（fallback 対象外）とする。
    "aborted",
  ])("returns false for non-offline FirebaseError code %s", (code) => {
    expect(isOfflineFirestoreErrorCode(code)).toBe(false);
  });

  it("accepts firestore/ prefix form for offline codes", () => {
    expect(isOfflineFirestoreErrorCode("firestore/unavailable")).toBe(true);
    expect(isOfflineFirestoreErrorCode("firestore/cancelled")).toBe(true);
  });

  it("rejects firestore/ prefix form for non-offline codes", () => {
    expect(isOfflineFirestoreErrorCode("firestore/permission-denied")).toBe(false);
    expect(isOfflineFirestoreErrorCode("firestore/not-found")).toBe(false);
  });

  it("returns false for unknown / empty / unrelated codes", () => {
    expect(isOfflineFirestoreErrorCode("unknown")).toBe(false);
    expect(isOfflineFirestoreErrorCode("")).toBe(false);
    expect(isOfflineFirestoreErrorCode("auth/popup-blocked")).toBe(false);
    expect(isOfflineFirestoreErrorCode("tournament/invalid-state")).toBe(false);
  });
});
