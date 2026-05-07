import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetFontCacheForTest } from "@/app/api/og/_lib/load-font";

/**
 * Phase B: winner card route の薄い status / content-type 検査。
 *
 * `next/og` の `ImageResponse` は実装上 wasm を要求するため、テストでは mock に置換し
 * 「正しい引数で呼ばれた」「Response として `image/png` を返せる形に組み立てている」
 * の 2 点だけ assert する。実際の PNG bytes 検証は manual / E2E に委ねる。
 */

vi.mock("next/og", () => ({
  ImageResponse: vi.fn().mockImplementation(() => {
    return new Response("fake-png", {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }),
}));

vi.mock("@/app/api/og/_lib/load-font", () => ({
  loadNotoSansJPCached: vi.fn().mockResolvedValue({
    regular: new ArrayBuffer(8),
    bold: new ArrayBuffer(8),
  }),
  __resetFontCacheForTest: vi.fn(),
}));

import { ImageResponse } from "next/og";
import { loadNotoSansJPCached } from "@/app/api/og/_lib/load-font";
import { GET } from "./route";

const VALID_QUERY = new URLSearchParams({
  winnerName: "Alice",
  tournamentName: "サタデートーナメント",
  participants: "8",
  finishedAtLabel: "2026/5/6",
}).toString();

function buildRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/og/winner/t-1?${query}`);
}

describe("GET /api/og/winner/[tid]", () => {
  beforeEach(() => {
    vi.mocked(ImageResponse).mockReset();
    vi.mocked(ImageResponse).mockImplementation(
      () =>
        new Response("fake-png", {
          status: 200,
          headers: { "content-type": "image/png" },
        }) as unknown as InstanceType<typeof ImageResponse>,
    );
    vi.mocked(loadNotoSansJPCached).mockReset();
    vi.mocked(loadNotoSansJPCached).mockResolvedValue({
      regular: new ArrayBuffer(8),
      bold: new ArrayBuffer(8),
    });
    __resetFontCacheForTest();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("有効な query で 200 image/png を返す", async () => {
    const req = buildRequest(VALID_QUERY);
    const res = await GET(req, { params: Promise.resolve({ tid: "t-1" }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(loadNotoSansJPCached).toHaveBeenCalledTimes(1);
    expect(ImageResponse).toHaveBeenCalledTimes(1);
  });

  it("有効な query で ImageResponse に Noto Sans JP の 2 weight が渡される", async () => {
    const req = buildRequest(VALID_QUERY);
    await GET(req, { params: Promise.resolve({ tid: "t-1" }) });

    const call = vi.mocked(ImageResponse).mock.calls[0];
    const opts = call[1] as { fonts: Array<{ name: string; weight: number }> };
    expect(opts.fonts.map((f) => f.weight).sort()).toEqual([400, 700]);
    expect(opts.fonts.every((f) => f.name === "Noto Sans JP")).toBe(true);
  });

  it("成功 response に Cache-Control（CDN edge cache 有効）と Content-Disposition が乗る", async () => {
    const sp = new URLSearchParams(VALID_QUERY);
    sp.set("filename", "winner-saturday-2026-05-06");
    const req = buildRequest(sp.toString());
    const res = await GET(req, { params: Promise.resolve({ tid: "t-1" }) });

    expect(res.headers.get("cache-control")).toContain("public");
    expect(res.headers.get("cache-control")).toContain("s-maxage=86400");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="winner-saturday-2026-05-06.png"',
    );
  });

  it("filename が指定されない場合 Content-Disposition は 'card.png' に fallback", async () => {
    const req = buildRequest(VALID_QUERY);
    const res = await GET(req, { params: Promise.resolve({ tid: "t-1" }) });

    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="card.png"',
    );
  });

  it("filename query は route 側で再 sanitize される（信頼境界）", async () => {
    const sp = new URLSearchParams(VALID_QUERY);
    // schema は ASCII 文字種を強制しないため、route 側で sanitizeFilename を再適用する必要あり
    sp.set("filename", "../../etc/passwd");
    const req = buildRequest(sp.toString());
    const res = await GET(req, { params: Promise.resolve({ tid: "t-1" }) });

    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).not.toContain("/");
    expect(cd).not.toContain("..");
    expect(cd).toMatch(/^attachment; filename="[A-Za-z0-9_-]+\.png"$/);
  });

  it("不正な query は 400 og/invalid-params を返す", async () => {
    const req = buildRequest("winnerName=&tournamentName=&participants=0");
    const res = await GET(req, { params: Promise.resolve({ tid: "t-1" }) });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("og/invalid-params");
    expect(ImageResponse).not.toHaveBeenCalled();
  });

  it("finishedAtLabel が空文字なら 400", async () => {
    const sp = new URLSearchParams({
      winnerName: "Alice",
      tournamentName: "サタデー",
      participants: "8",
      finishedAtLabel: "",
    });
    const req = buildRequest(sp.toString());
    const res = await GET(req, { params: Promise.resolve({ tid: "t-1" }) });

    expect(res.status).toBe(400);
  });

  it("font load が throw した場合 500 og/render-failed を返す", async () => {
    vi.mocked(loadNotoSansJPCached).mockRejectedValueOnce(
      new Error("file not found"),
    );
    const req = buildRequest(VALID_QUERY);
    const res = await GET(req, { params: Promise.resolve({ tid: "t-1" }) });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("og/render-failed");
  });
});
