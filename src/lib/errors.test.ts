import { describe, it, expect } from "vitest";
import { AppError } from "./errors";

describe("AppError", () => {
  it("holds code and wrapped cause", () => {
    const cause = new Error("root");
    const e = new AppError("failed", "firestore/read_failed", cause);
    expect(e.code).toBe("firestore/read_failed");
    expect(e.cause).toBe(cause);
    expect(e.name).toBe("AppError");
    expect(e.message).toBe("failed");
  });

  it("from() passes through existing AppError", () => {
    const original = new AppError("orig", "auth/unknown");
    const wrapped = AppError.from(original, "ignored/code");
    expect(wrapped).toBe(original);
  });

  it("from() wraps a plain Error with code", () => {
    const plain = new Error("boom");
    const wrapped = AppError.from(plain, "firestore/write_failed");
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.code).toBe("firestore/write_failed");
    expect(wrapped.cause).toBe(plain);
    expect(wrapped.message).toBe("boom");
  });

  it("from() uses explicit message when provided", () => {
    const wrapped = AppError.from(new Error("raw"), "auth/x", "custom");
    expect(wrapped.message).toBe("custom");
  });

  it("from() handles non-Error values", () => {
    const wrapped = AppError.from("string error", "tournament/unknown");
    expect(wrapped.message).toBe("Unknown error");
    expect(wrapped.cause).toBe("string error");
  });
});
