import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

import { wrapFirestoreRead, wrapFirestoreWrite } from "./wrap";

describe("wrapFirestoreWrite / wrapFirestoreRead", () => {
  it("returns op result on success without warn log", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    const result = await wrapFirestoreWrite(
      "firestore/write_failed",
      "should not be used",
      async () => 42,
    );
    expect(result).toBe(42);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("wraps a thrown plain Error into AppError with the given code", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const op = vi.fn(async () => {
      throw new Error("boom");
    });

    let caught: unknown = null;
    try {
      await wrapFirestoreWrite(
        "firestore/write_failed",
        "保存に失敗しました",
        op,
        { gid: "g1" },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("firestore/write_failed");
    expect((caught as AppError).message).toBe("保存に失敗しました");
    expect(warnSpy).toHaveBeenCalledWith(
      "保存に失敗しました",
      expect.objectContaining({ code: "firestore/write_failed", gid: "g1" }),
    );
    warnSpy.mockRestore();
  });

  it("preserves an existing AppError instead of double-wrapping", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const original = new AppError("orig", "auth/x");
    const op = vi.fn(async () => {
      throw original;
    });

    let caught: unknown = null;
    try {
      await wrapFirestoreRead("firestore/read_failed", "ignored", op);
    } catch (e) {
      caught = e;
    }
    // AppError.from で既存 AppError は素通しされるため、code は元の "auth/x" のまま。
    expect(caught).toBe(original);
    expect((caught as AppError).code).toBe("auth/x");
    // warn は元の AppError.code で 1 回出る。
    expect(warnSpy).toHaveBeenCalledWith(
      "orig",
      expect.objectContaining({ code: "auth/x" }),
    );
    warnSpy.mockRestore();
  });

  it("propagates op errors after warn (re-throws same instance)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const e1 = new Error("net");
    let caught: unknown = null;
    try {
      await wrapFirestoreWrite("firestore/write_failed", "...", async () => {
        throw e1;
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).cause).toBe(e1);
    warnSpy.mockRestore();
  });

  it("forwards meta fields to logger.warn alongside code", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      await wrapFirestoreRead(
        "firestore/read_failed",
        "読込失敗",
        async () => {
          throw new Error("x");
        },
        { tid: "t1", uid: "u1" },
      );
    } catch {
      // expected
    }
    expect(warnSpy).toHaveBeenCalledWith(
      "読込失敗",
      expect.objectContaining({
        code: "firestore/read_failed",
        tid: "t1",
        uid: "u1",
      }),
    );
    warnSpy.mockRestore();
  });
});
