import { test, expect } from "./fixtures/test-context";

/**
 * Phase A — PWA Foundation の E2E カバレッジ。
 *
 * 検証対象（emulator seeding 不要 / auth 不要のため signed-out で完結）:
 *   1. `/manifest.webmanifest` が valid JSON で配信され、`display: "standalone"` /
 *      `start_url: "/"` / `scope: "/"` / icons[]（any × 2 + maskable × 1） が揃う
 *   2. `public/icons/*` の 4 ファイル（192 / 512 / 512-maskable / apple-180）が
 *      200 OK で image/png として配信される
 *   3. `app/layout.tsx` の Next.js metadata が `<head>` に
 *      manifest link / theme-color / apple-mobile-web-app-* / apple-touch-icon を inject する
 *   4. `<IOsInstallHint />` が UA に応じて出し分けられる:
 *      - 既定の Desktop Chrome では非表示
 *      - iPhone UA を被せた context では「ホーム画面に追加」hint が表示される
 *      - iPhone UA でも `display-mode: standalone` のときは非表示
 *
 * 検証外:
 *   - Service Worker registration（`process.env.NODE_ENV !== "production"` で
 *     dev では no-op、`ServiceWorkerRegistration.tsx` の unit 仕様は IOsInstallHint と同型のため割愛）
 *   - Lighthouse PWA score / install prompt 発火（ブラウザ engagement heuristics に依存し
 *     不安定。手動検証で担保）
 */

test.describe("PWA Foundation (Phase A)", () => {
  test("/manifest.webmanifest が valid JSON で配信され、必須フィールドが揃う", async ({
    request,
  }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);

    const manifest = (await res.json()) as Record<string, unknown>;

    expect(manifest.name).toBe("ALLin-PokerTimer");
    expect(manifest.short_name).toBe("ALLin");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#0a0a0f");
    expect(manifest.background_color).toBe("#ffffff");
    expect(manifest.lang).toBe("ja");

    const icons = manifest.icons as Array<{
      src: string;
      sizes: string;
      type: string;
      purpose?: string;
    }>;
    expect(Array.isArray(icons)).toBe(true);

    const has192 = icons.some(
      (i) => i.sizes === "192x192" && i.src === "/icons/icon-192.png",
    );
    const has512Any = icons.some(
      (i) =>
        i.sizes === "512x512" &&
        i.src === "/icons/icon-512.png" &&
        (i.purpose ?? "any").includes("any"),
    );
    const has512Maskable = icons.some(
      (i) =>
        i.sizes === "512x512" &&
        i.src === "/icons/icon-512-maskable.png" &&
        (i.purpose ?? "").includes("maskable"),
    );
    expect(has192, "192x192 icon entry が必要").toBe(true);
    expect(has512Any, "512x512 (any) icon entry が必要").toBe(true);
    expect(has512Maskable, "512x512 (maskable) icon entry が必要").toBe(true);
  });

  test("PWA アイコン 4 種が 200 OK で image/png 配信される", async ({ request }) => {
    const paths = [
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-512-maskable.png",
      "/icons/apple-icon-180.png",
    ] as const;

    for (const path of paths) {
      const res = await request.get(path);
      expect(res.status(), `${path} should be 200`).toBe(200);
      const ct = res.headers()["content-type"] ?? "";
      expect(ct, `${path} should be image/png`).toContain("image/png");
      const buf = await res.body();
      expect(buf.byteLength, `${path} should not be empty`).toBeGreaterThan(0);
    }
  });

  test("layout.tsx metadata が manifest link / theme-color / apple-mobile-web-app-* を head に inject する", async ({
    page,
  }) => {
    await page.goto("/");

    // Next.js は metadata.manifest を `<link rel="manifest">` に展開する
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute("href", /manifest\.webmanifest/);

    // viewport.themeColor → <meta name="theme-color" content="#0a0a0f">
    const themeColor = page.locator('meta[name="theme-color"]');
    await expect(themeColor).toHaveAttribute("content", "#0a0a0f");

    // appleWebApp.title (capable) → Next.js 15 は title を必ず吐き、capable も状態に応じて吐く。
    // ただし `apple-mobile-web-app-capable` は近年「`mobile-web-app-capable` を使え」という
    // 警告が増えており、Next.js のバージョンによって名前が分岐する。両方どちらかが
    // `yes` で出ていればよしとする（HEAD タグの存在自体を担保）。
    const capableYes = await page.evaluate(() => {
      const a = document.querySelector('meta[name="apple-mobile-web-app-capable"]');
      const m = document.querySelector('meta[name="mobile-web-app-capable"]');
      return {
        apple: a?.getAttribute("content") ?? null,
        modern: m?.getAttribute("content") ?? null,
      };
    });
    expect(
      capableYes.apple === "yes" || capableYes.modern === "yes",
      `capable meta missing: ${JSON.stringify(capableYes)}`,
    ).toBe(true);

    // appleWebApp.statusBarStyle → black-translucent
    const appleStatusBar = page.locator(
      'meta[name="apple-mobile-web-app-status-bar-style"]',
    );
    await expect(appleStatusBar).toHaveAttribute("content", "black-translucent");

    // icons.apple → <link rel="apple-touch-icon" href="/icons/apple-icon-180.png">
    const appleTouch = page.locator('link[rel="apple-touch-icon"]');
    await expect(appleTouch).toHaveAttribute("href", /apple-icon-180\.png/);
  });

  test("IOsInstallHint: 既定の Desktop Chrome では表示されない", async ({ page }) => {
    await page.goto("/");
    const hint = page.getByRole("note").filter({ hasText: "ホーム画面に追加" });
    await expect(hint).toHaveCount(0);
  });

  test("IOsInstallHint: iPhone UA + 非 standalone では表示される", async ({ browser }) => {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    try {
      const page = await context.newPage();
      await page.goto("/");

      const hint = page.getByRole("note").filter({ hasText: "ホーム画面に追加" });
      await expect(hint).toBeVisible();

      // 文中に「共有」 + Share アイコンの aria-hidden を含む
      await expect(hint).toContainText("共有");
    } finally {
      await context.close();
    }
  });

  test("IOsInstallHint: iPhone UA でも standalone display-mode では非表示", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    try {
      const page = await context.newPage();

      // navigate 前に `matchMedia("(display-mode: standalone)")` が
      // 常に true を返すよう init script で差し込む。
      await page.addInitScript(() => {
        const orig = window.matchMedia;
        window.matchMedia = (query: string): MediaQueryList => {
          if (query === "(display-mode: standalone)") {
            return {
              matches: true,
              media: query,
              onchange: null,
              addListener: () => {},
              removeListener: () => {},
              addEventListener: () => {},
              removeEventListener: () => {},
              dispatchEvent: () => false,
            } as MediaQueryList;
          }
          return orig.call(window, query);
        };
      });

      await page.goto("/");

      const hint = page.getByRole("note").filter({ hasText: "ホーム画面に追加" });
      await expect(hint).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
