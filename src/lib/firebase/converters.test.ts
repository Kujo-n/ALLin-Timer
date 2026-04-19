import { Timestamp, type QueryDocumentSnapshot } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AppError } from "@/lib/errors";

import { zodConverter } from "./converters";

const schema = z.object({
  name: z.string().min(1),
  createdAt: z.instanceof(Timestamp),
});

function makeSnap(id: string, data: unknown): QueryDocumentSnapshot {
  return {
    id,
    data: () => data as Record<string, unknown>,
  } as unknown as QueryDocumentSnapshot;
}

describe("zodConverter", () => {
  const converter = zodConverter(schema, "tournaments");

  it("fromFirestore returns parsed data on valid input", () => {
    const ts = Timestamp.fromMillis(Date.now());
    const snap = makeSnap("abc", { name: "Alice", createdAt: ts });
    const result = converter.fromFirestore(snap, {});
    expect(result).toEqual({ name: "Alice", createdAt: ts });
  });

  it("fromFirestore throws AppError with firestore/invalid-data on schema mismatch", () => {
    const snap = makeSnap("abc", { name: 123 });
    try {
      converter.fromFirestore(snap, {});
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("firestore/invalid-data");
    }
  });

  it("toFirestore returns the payload as-is", () => {
    const payload = { name: "Alice", createdAt: Timestamp.fromMillis(0) };
    const result = converter.toFirestore(payload);
    expect(result).toEqual(payload);
  });
});
