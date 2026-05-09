import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `public/sw.js` は vanilla JS で配信される（ESM 不可・TS 不可）。bundle / transform を経ずに
// 配布されるため、`shouldCacheNavigate` の挙動を export 経由でテストできない。
// ファイル本体を文字列で読み込み、`NAVIGATE_CACHE_ALLOWLIST` 配列リテラルと
// `shouldCacheNavigate` 関数本体を抽出して Node の `new Function` で評価する。
// regex 抽出が壊れる（rename / 構造変更）と test setup で throw し、drift を fail で気付ける。

const here = dirname(fileURLToPath(import.meta.url));
const swPath = resolve(here, "../../../public/sw.js");
const swSource = readFileSync(swPath, "utf8");

const allowlistMatch = swSource.match(
  /const\s+NAVIGATE_CACHE_ALLOWLIST\s*=\s*(\[[^\]]+\])\s*;/,
);
if (!allowlistMatch) {
  throw new Error("NAVIGATE_CACHE_ALLOWLIST literal not found in public/sw.js");
}
const allowlist = JSON.parse(allowlistMatch[1]) as string[];

const fnMatch = swSource.match(
  /function\s+shouldCacheNavigate\(pathname\)\s*\{[\s\S]*?\n\}/,
);
if (!fnMatch) {
  throw new Error("shouldCacheNavigate function not found in public/sw.js");
}

const shouldCacheNavigate = new Function(
  "NAVIGATE_CACHE_ALLOWLIST",
  `${fnMatch[0]}\nreturn shouldCacheNavigate;`,
)(allowlist) as (pathname: string) => boolean;

describe("public/sw.js NAVIGATE_CACHE_ALLOWLIST contract", () => {
  it("Phase 4 で必要な 3 entry を含む", () => {
    expect(allowlist).toEqual(expect.arrayContaining(["/", "/login", "/spectate"]));
  });
});

describe("public/sw.js shouldCacheNavigate", () => {
  it.each<[string, boolean]>([
    ["/", true],
    ["/login", true],
    ["/login/forgot-password", true],
    ["/spectate", true],
    ["/spectate/abc123def456", true],
    ["/spectate/t-1/sub", true],
  ])("allow: %s → %s", (path, expected) => {
    expect(shouldCacheNavigate(path)).toBe(expected);
  });

  it.each<[string, boolean]>([
    ["", false],
    ["/foo", false],
    ["/spectatethief", false],
    ["/groups/g-1", false],
    ["/tournaments/t-1", false],
    ["/tournaments/t-1/live", false],
    ["/settings", false],
    ["/account", false],
    ["/structures/s-1", false],
    ["/join/t-1", false],
  ])("deny: %s → %s", (path, expected) => {
    expect(shouldCacheNavigate(path)).toBe(expected);
  });

  it("ルート exact 判定が trailing-slash sensitive である（既存 sw.js の特例）", () => {
    expect(shouldCacheNavigate("/")).toBe(true);
    expect(shouldCacheNavigate("//")).toBe(false);
  });
});
