import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";

import { ShareCardButton } from "./ShareCardButton";
import * as canShareModule from "./use-can-share-image";

const realNavigator = globalThis.navigator;
const realFetch = globalThis.fetch;

function makePngResponse(): Response {
  return new Response(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]), {
    status: 200,
    headers: { "Content-Type": "image/png" },
  });
}

function stubNavigatorShare(opts: {
  canShare?: ReturnType<typeof vi.fn>;
  share?: ReturnType<typeof vi.fn>;
}) {
  vi.stubGlobal("navigator", {
    ...realNavigator,
    canShare: opts.canShare ?? vi.fn().mockReturnValue(true),
    share: opts.share ?? vi.fn().mockResolvedValue(undefined),
  });
}

beforeEach(() => {
  vi.spyOn(canShareModule, "useCanShareImage").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (globalThis.navigator !== realNavigator) {
    Object.defineProperty(globalThis, "navigator", {
      value: realNavigator,
      configurable: true,
      writable: true,
    });
  }
  globalThis.fetch = realFetch;
});

describe("ShareCardButton — render gating", () => {
  it("useCanShareImage が 'loading' のときは null を返す", () => {
    vi.spyOn(canShareModule, "useCanShareImage").mockReturnValue("loading");
    const { container } = render(
      <ShareCardButton
        url="/api/og/winner/t-1?x=1"
        filenameStem="winner-x"
        shareText="hi"
        kind="winner"
        label="シェア"
        dataTestId="share-btn"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("useCanShareImage が false のときは null を返す", () => {
    vi.spyOn(canShareModule, "useCanShareImage").mockReturnValue(false);
    const { container } = render(
      <ShareCardButton
        url="/api/og/winner/t-1?x=1"
        filenameStem="winner-x"
        shareText="hi"
        kind="winner"
        label="シェア"
        dataTestId="share-btn"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("useCanShareImage が true のときは button を render する", () => {
    render(
      <ShareCardButton
        url="/api/og/winner/t-1?x=1"
        filenameStem="winner-x"
        shareText="hi"
        kind="winner"
        label="シェア"
        dataTestId="share-btn"
      />,
    );
    expect(screen.getByTestId("share-btn")).toBeInTheDocument();
    expect(screen.getByText("シェア")).toBeInTheDocument();
  });
});

describe("ShareCardButton — click behaviour", () => {
  it("click → fetch → File 作成 → navigator.share 呼出 → logger.debug success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makePngResponse());
    globalThis.fetch = fetchMock as typeof fetch;

    const shareMock = vi.fn().mockResolvedValue(undefined);
    const canShareMock = vi.fn().mockReturnValue(true);
    stubNavigatorShare({ canShare: canShareMock, share: shareMock });

    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});

    render(
      <ShareCardButton
        url="/api/og/winner/t-1?x=1"
        filenameStem="winner-card"
        shareText="優勝!"
        kind="winner"
        label="シェア"
        dataTestId="share-btn"
      />,
    );
    fireEvent.click(screen.getByTestId("share-btn"));

    await waitFor(() => {
      expect(shareMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/og/winner/t-1?x=1", {
      cache: "no-store",
    });
    const shareArg = shareMock.mock.calls[0][0] as {
      files: File[];
      text: string;
    };
    expect(shareArg.files[0].name).toBe("winner-card.png");
    expect(shareArg.files[0].type).toBe("image/png");
    expect(shareArg.text).toBe("優勝!");
    expect(debugSpy).toHaveBeenCalledWith(
      "share-card click",
      expect.objectContaining({
        kind: "winner",
        action: "share",
        success: true,
      }),
    );
  });

  it("AbortError は silent: logger.warn を呼ばない", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makePngResponse());
    globalThis.fetch = fetchMock as typeof fetch;

    const abortError = new DOMException("aborted", "AbortError");
    const shareMock = vi.fn().mockRejectedValue(abortError);
    stubNavigatorShare({ share: shareMock });

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});

    render(
      <ShareCardButton
        url="/api/og/winner/t-1"
        filenameStem="x"
        shareText="hi"
        kind="winner"
        label="シェア"
        dataTestId="share-btn"
      />,
    );
    fireEvent.click(screen.getByTestId("share-btn"));

    await waitFor(() => {
      expect(shareMock).toHaveBeenCalled();
    });
    // AbortError は silent（success path に到達しないため debug も呼ばれない）
    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("fetch が 500 を返すと logger.warn / navigator.share は呼ばれない", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("err", { status: 500 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const shareMock = vi.fn();
    stubNavigatorShare({ share: shareMock });

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    render(
      <ShareCardButton
        url="/api/og/winner/t-1"
        filenameStem="x"
        shareText="hi"
        kind="winner"
        label="シェア"
        dataTestId="share-btn"
      />,
    );
    fireEvent.click(screen.getByTestId("share-btn"));

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });
    expect(shareMock).not.toHaveBeenCalled();
    const [, meta] = warnSpy.mock.calls[0];
    expect((meta as { code: string }).code).toBe("share/fetch-failed");
  });

  it("share() が generic Error を throw すると logger.warn を呼ぶ", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makePngResponse());
    globalThis.fetch = fetchMock as typeof fetch;

    const shareMock = vi.fn().mockRejectedValue(new Error("network"));
    stubNavigatorShare({ share: shareMock });

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    render(
      <ShareCardButton
        url="/api/og/winner/t-1"
        filenameStem="x"
        shareText="hi"
        kind="winner"
        label="シェア"
        dataTestId="share-btn"
      />,
    );
    fireEvent.click(screen.getByTestId("share-btn"));

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });
    const [, meta] = warnSpy.mock.calls[0];
    expect((meta as { code: string }).code).toBe("share/failed");
    expect((meta as { kind: string }).kind).toBe("winner");
  });

  it("canShare({files}) が突然 false を返したら logger.warn / share は呼ばれない", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makePngResponse());
    globalThis.fetch = fetchMock as typeof fetch;

    const shareMock = vi.fn();
    stubNavigatorShare({
      canShare: vi.fn().mockReturnValue(false),
      share: shareMock,
    });

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    render(
      <ShareCardButton
        url="/api/og/winner/t-1"
        filenameStem="x"
        shareText="hi"
        kind="season"
        label="シェア"
        dataTestId="share-btn"
      />,
    );
    fireEvent.click(screen.getByTestId("share-btn"));

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });
    expect(shareMock).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toBe("share/canshare-false-after-fetch");
  });
});
