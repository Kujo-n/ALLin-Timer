import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

import { resizeImageToCardSize } from "./image-resize";

/**
 * jsdom は canvas のピクセル描画を実装しないため、resizeImageToCardSize の
 * pixel-level な正しさは検証できない。ここでは以下の characterization を行う:
 *
 *  - getContext / drawImage / toBlob の呼出シーケンスが期待通り
 *  - getContext が null を返したとき `image/canvas-unavailable` を throw
 *  - toBlob が null を返したとき `image/encode-failed` を throw
 *  - Image.onerror で `image/load-failed` を throw
 *  - URL.createObjectURL / revokeObjectURL を必ず呼ぶ（リークなし）
 */

interface MockCtx {
  drawImage: ReturnType<typeof vi.fn>;
}

function setupCanvasMocks(opts: {
  ctx: MockCtx | null;
  toBlobReturn: Blob | null;
}) {
  const getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(opts.ctx as unknown as CanvasRenderingContext2D | null);

  const toBlobSpy = vi
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation(function (this: HTMLCanvasElement, callback) {
      // 非同期で resolve させて Promise wrapper の挙動を再現
      queueMicrotask(() => callback(opts.toBlobReturn));
    });

  return { getContextSpy, toBlobSpy };
}

function setupImageMock(opts: { naturalWidth: number; naturalHeight: number; fail?: boolean }) {
  // jsdom の HTMLImageElement は src 代入直後に onload を発火しないため、
  // Image() を直接差し替えるのが手堅い。
  const OrigImage = global.Image;
  class FakeImage {
    width = opts.naturalWidth;
    height = opts.naturalHeight;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      // microtask 後に onload / onerror を発火
      queueMicrotask(() => {
        if (opts.fail) {
          this.onerror?.();
        } else {
          this.onload?.();
        }
      });
    }
  }
  (global as unknown as { Image: unknown }).Image = FakeImage;
  return () => {
    (global as unknown as { Image: unknown }).Image = OrigImage;
  };
}

function fakeFile(): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], "test.jpg", {
    type: "image/jpeg",
  });
}

describe("resizeImageToCardSize", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let restoreImage: (() => void) | null = null;

  beforeEach(() => {
    // jsdom には URL.createObjectURL / revokeObjectURL が無いので、初回は
    // method を生やしてから spyOn する。
    if (typeof URL.createObjectURL !== "function") {
      (URL as unknown as { createObjectURL: () => string }).createObjectURL =
        () => "";
    }
    if (typeof URL.revokeObjectURL !== "function") {
      (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL =
        () => {};
    }
    createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:fake") as unknown as ReturnType<typeof vi.fn>;
    revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {}) as unknown as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (restoreImage) {
      restoreImage();
      restoreImage = null;
    }
  });

  it("通常 landscape 入力 → toBlob 経由で Blob を返す（drawImage cover フィット）", async () => {
    restoreImage = setupImageMock({ naturalWidth: 1600, naturalHeight: 900 });
    const drawImage = vi.fn();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    setupCanvasMocks({ ctx: { drawImage }, toBlobReturn: blob });

    const result = await resizeImageToCardSize(fakeFile());
    expect(result).toBe(blob);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("portrait 入力でも cover フィットの drawImage が呼ばれる", async () => {
    restoreImage = setupImageMock({ naturalWidth: 600, naturalHeight: 1200 });
    const drawImage = vi.fn();
    const blob = new Blob([new Uint8Array([4, 5, 6])], { type: "image/jpeg" });
    setupCanvasMocks({ ctx: { drawImage }, toBlobReturn: blob });

    const result = await resizeImageToCardSize(fakeFile());
    expect(result).toBe(blob);
    expect(drawImage).toHaveBeenCalledTimes(1);
    // cover フィットの計算: scale=max(1200/600, 630/1200)=2 → drawW=1200, drawH=2400, dy=-885
    const args = drawImage.mock.calls[0];
    expect(args[3]).toBeCloseTo(1200);
    expect(args[4]).toBeCloseTo(2400);
  });

  it("getContext が null を返すと AppError(image/canvas-unavailable)", async () => {
    restoreImage = setupImageMock({ naturalWidth: 100, naturalHeight: 100 });
    setupCanvasMocks({ ctx: null, toBlobReturn: null });

    await expect(resizeImageToCardSize(fakeFile())).rejects.toThrow(AppError);
    await expect(resizeImageToCardSize(fakeFile())).rejects.toMatchObject({
      code: "image/canvas-unavailable",
    });
    // revoke は必ず呼ばれる（finally）
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it("toBlob が null を返すと AppError(image/encode-failed)", async () => {
    restoreImage = setupImageMock({ naturalWidth: 800, naturalHeight: 600 });
    setupCanvasMocks({ ctx: { drawImage: vi.fn() }, toBlobReturn: null });

    await expect(resizeImageToCardSize(fakeFile())).rejects.toMatchObject({
      code: "image/encode-failed",
    });
  });

  it("Image.onerror で AppError(image/load-failed)", async () => {
    restoreImage = setupImageMock({
      naturalWidth: 0,
      naturalHeight: 0,
      fail: true,
    });
    setupCanvasMocks({ ctx: { drawImage: vi.fn() }, toBlobReturn: null });

    await expect(resizeImageToCardSize(fakeFile())).rejects.toMatchObject({
      code: "image/load-failed",
    });
    expect(revokeObjectURL).toHaveBeenCalled();
  });
});
