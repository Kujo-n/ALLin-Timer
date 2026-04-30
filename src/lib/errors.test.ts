import { describe, it, expect } from "vitest";
import { AppError, getErrorCode, unwrapOrFrom } from "./errors";

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

describe("unwrapOrFrom", () => {
  it("returns the original AppError instance when given one", () => {
    const original = new AppError("orig", "auth/x");
    const result = unwrapOrFrom(original, "ignored/code", "ignored");
    expect(result).toBe(original);
    expect(result.code).toBe("auth/x");
  });

  it("wraps a plain Error like AppError.from", () => {
    const plain = new Error("boom");
    const result = unwrapOrFrom(plain, "firestore/write_failed", "msg");
    expect(result).toBeInstanceOf(AppError);
    expect(result.code).toBe("firestore/write_failed");
    expect(result.message).toBe("msg");
    expect(result.cause).toBe(plain);
  });

  it("wraps non-Error values", () => {
    const result = unwrapOrFrom("oops", "tournament/unknown");
    expect(result).toBeInstanceOf(AppError);
    expect(result.code).toBe("tournament/unknown");
  });
});

describe("getErrorCode", () => {
  it("returns AppError.code", () => {
    expect(getErrorCode(new AppError("m", "auth/x"))).toBe("auth/x");
  });

  it("reads code from object with string code (e.g., FirebaseError)", () => {
    expect(getErrorCode({ code: "auth/popup-blocked", message: "..." })).toBe(
      "auth/popup-blocked",
    );
  });

  it("returns 'unknown' for plain Error without code", () => {
    expect(getErrorCode(new Error("plain"))).toBe("unknown");
  });

  it("returns 'unknown' for null / undefined / primitives", () => {
    expect(getErrorCode(null)).toBe("unknown");
    expect(getErrorCode(undefined)).toBe("unknown");
    expect(getErrorCode("string")).toBe("unknown");
    expect(getErrorCode(42)).toBe("unknown");
  });

  it("returns 'unknown' for object with non-string code", () => {
    expect(getErrorCode({ code: 500 })).toBe("unknown");
  });
});
