import { describe, it, expect } from "vitest";
import {
  AppError,
  assertNonEmptyString,
  formatErrorForDisplay,
  getErrorCode,
  unwrapOrFrom,
} from "./errors";

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

describe("formatErrorForDisplay", () => {
  it("formats an AppError as `<code>: <message>`", () => {
    const err = new AppError("失敗しました", "firestore/write_failed");
    expect(formatErrorForDisplay(err)).toBe(
      "firestore/write_failed: 失敗しました",
    );
  });

  it("formats a FirebaseError-like object", () => {
    expect(
      formatErrorForDisplay({ code: "auth/popup-blocked", message: "popup" }),
    ).toBe("auth/popup-blocked: popup");
  });
});

describe("assertNonEmptyString", () => {
  it("passes through non-empty strings", () => {
    expect(() => assertNonEmptyString("abc", "tid")).not.toThrow();
    expect(() => assertNonEmptyString("a b c", "name")).not.toThrow();
  });

  it("throws AppError(validation/empty-string) for empty string", () => {
    let caught: unknown = null;
    try {
      assertNonEmptyString("", "tid");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("validation/empty-string");
    expect((caught as AppError).message).toBe("tid を指定してください");
  });

  it("throws for whitespace-only string", () => {
    expect(() => assertNonEmptyString("   ", "uid")).toThrow(
      expect.objectContaining({ code: "validation/empty-string" }),
    );
    expect(() => assertNonEmptyString("\t\n", "uid")).toThrow(
      expect.objectContaining({ code: "validation/empty-string" }),
    );
  });

  it("throws for non-string values (null / undefined / number / object)", () => {
    expect(() => assertNonEmptyString(null, "gid")).toThrow(
      expect.objectContaining({ code: "validation/empty-string" }),
    );
    expect(() => assertNonEmptyString(undefined, "gid")).toThrow(
      expect.objectContaining({ code: "validation/empty-string" }),
    );
    expect(() => assertNonEmptyString(0, "gid")).toThrow(
      expect.objectContaining({ code: "validation/empty-string" }),
    );
    expect(() => assertNonEmptyString({}, "gid")).toThrow(
      expect.objectContaining({ code: "validation/empty-string" }),
    );
  });

  it("includes the paramName in the thrown message", () => {
    expect(() => assertNonEmptyString("", "myParam")).toThrow(
      "myParam を指定してください",
    );
  });
});
