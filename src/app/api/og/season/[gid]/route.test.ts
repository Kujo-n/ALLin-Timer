import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetFontCacheForTest } from "@/app/api/og/_lib/load-font";

vi.mock("next/og", () => ({
  ImageResponse: vi.fn().mockImplementation(() => {
    return new Response("fake-png", {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }),
}));

vi.mock("@/app/api/og/_lib/load-font", () => ({
  loadNotoSansJPCached: vi.fn(),
  __resetFontCacheForTest: vi.fn(),
}));

import { ImageResponse } from "next/og";
import { loadNotoSansJPCached } from "@/app/api/og/_lib/load-font";
import { GET } from "./route";

const FULL_QUERY = new URLSearchParams({
  groupName: "サタデーサークル",
  seasonStartDateLabel: "2026/4/1",
  top1Name: "Alice",
  top1Points: "47.83",
  top2Name: "Bob",
  top2Points: "28.12",
  top3Name: "Carol",
  top3Points: "19.66",
}).toString();

function buildRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/og/season/g-1?${query}`);
}

describe("GET /api/og/season/[gid]", () => {
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
    const req = buildRequest(FULL_QUERY);
    const res = await GET(req, { params: Promise.resolve({ gid: "g-1" }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(ImageResponse).toHaveBeenCalledTimes(1);
  });

  it("top1 のみでも 200 を返す（top2/top3 は optional）", async () => {
    const sp = new URLSearchParams({
      groupName: "G",
      top1Name: "Alice",
      top1Points: "10",
    });
    const req = buildRequest(sp.toString());
    const res = await GET(req, { params: Promise.resolve({ gid: "g-1" }) });

    expect(res.status).toBe(200);
  });

  it("seasonStartDateLabel なしでも 200 を返す（未開始シーズン）", async () => {
    const sp = new URLSearchParams({
      groupName: "G",
      top1Name: "Alice",
      top1Points: "10",
    });
    const req = buildRequest(sp.toString());
    const res = await GET(req, { params: Promise.resolve({ gid: "g-1" }) });

    expect(res.status).toBe(200);
  });

  it("成功 response に Cache-Control と Content-Disposition が乗る", async () => {
    const sp = new URLSearchParams(FULL_QUERY);
    sp.set("filename", "season-saturday-2026-04-01");
    const req = buildRequest(sp.toString());
    const res = await GET(req, { params: Promise.resolve({ gid: "g-1" }) });

    expect(res.headers.get("cache-control")).toContain("public");
    expect(res.headers.get("cache-control")).toContain("s-maxage=86400");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="season-saturday-2026-04-01.png"',
    );
  });

  it("filename が指定されない場合 Content-Disposition は 'card.png' に fallback", async () => {
    const req = buildRequest(FULL_QUERY);
    const res = await GET(req, { params: Promise.resolve({ gid: "g-1" }) });

    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="card.png"',
    );
  });

  it("groupName が空文字なら 400 og/invalid-params", async () => {
    const sp = new URLSearchParams({
      groupName: "",
      top1Name: "Alice",
      top1Points: "10",
    });
    const req = buildRequest(sp.toString());
    const res = await GET(req, { params: Promise.resolve({ gid: "g-1" }) });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("og/invalid-params");
    expect(ImageResponse).not.toHaveBeenCalled();
  });

  it("top1Points が負値なら 400", async () => {
    const sp = new URLSearchParams({
      groupName: "G",
      top1Name: "Alice",
      top1Points: "-1",
    });
    const req = buildRequest(sp.toString());
    const res = await GET(req, { params: Promise.resolve({ gid: "g-1" }) });

    expect(res.status).toBe(400);
  });

  it("font load が throw した場合 500 og/render-failed", async () => {
    vi.mocked(loadNotoSansJPCached).mockRejectedValueOnce(
      new Error("font missing"),
    );
    const req = buildRequest(FULL_QUERY);
    const res = await GET(req, { params: Promise.resolve({ gid: "g-1" }) });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("og/render-failed");
  });
});
