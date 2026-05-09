import { test, expect, type Page } from "./fixtures/test-context";

/**
 * Phase D — Install Promotion & Polish の E2E カバレッジ。
 *
 * 検証対象:
 *   1. トップ画面 `/` で `beforeinstallprompt` を発火するとカスタムバナーが表示される
 *   2. 「ホーム画面に追加」を押すと event.prompt() が呼ばれ、accepted のときに
 *      banner が消える（appinstalled は dispatch せず、prompt resolve 後の hide）
 *   3. 「今は閉じる」を押すと banner が消え、`localStorage["allinpt.pwaInstallDismissedAt"]`
 *      に ms epoch が書き込まれて 30 日 TTL に乗る（再 mount 時に再表示されない）
 *   4. mount 点限定設計 — `/login` には PwaInstallPromotion / IOsInstallHint いずれも mount されない
 *   5. `/sw.js` が Phase D で導入された invariant（CACHE_VERSION="v2" / NAVIGATE_CACHE_ALLOWLIST /
 *      MAX_RUNTIME_ENTRIES / shouldCacheNavigate）をすべて含む形で配信される
 *
 * 検証外（既存 unit でカバー）:
 *   - PwaInstallPromotion.test.tsx で 9 ケース（event 未捕捉 / capture+preventDefault /
 *     accepted / dismissed / 「今は閉じる」/ appinstalled / 5d / 31d / private mode）を網羅済み
 *   - IOsInstallHint.test.tsx で 7 ケース（UA / standalone / iPad / dismiss / 5d / 31d）を網羅済み
 *   - SW の runtime cache 動作（put / trim / fetch fallback）は dev では SW 未登録のため
 *     E2E 検証不可。`public/sw.js` の static contract のみ E2E で固定する
 *
 * NOTE: Chromium は engagement heuristics に依存して `beforeinstallprompt` を自然発火する。
 * Playwright 環境では発火しないため、JS から合成 Event を dispatch する（unit test の手法）。
 * dispatch は React の useEffect が listener を attach し終わった後でなければならないので、
 * トップ画面の heading が visible になるまで待ってから dispatch する。
 */

const STORAGE_KEY = "allinpt.pwaInstallDismissedAt";

interface DispatchOptions {
  outcome?: "accepted" | "dismissed";
}

/**
 * トップ画面ロード後に React がマウント済みであることを確認した上で
 * `beforeinstallprompt` を window へ dispatch する。
 */
async function dispatchBeforeInstallPrompt(
  page: Page,
  { outcome = "accepted" }: DispatchOptions = {},
): Promise<void> {
  // React の useEffect が listener を attach する前に dispatch すると取り逃す。
  // トップ画面の heading が visible = client component が render 済みなので listener attach 後と判定。
  await expect(
    page.getByRole("heading", { name: "ALLin-PokerTimer" }),
  ).toBeVisible({ timeout: 15_000 });

  await page.evaluate(
    ({ outcome }) => {
      const ev = new Event("beforeinstallprompt") as Event & {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
      };
      ev.prompt = () => {
        // 後続 assertion で確認するため、prompt() 呼出を window 経由で観測可能にする。
        (window as unknown as { __pwaPromptCalled?: boolean }).__pwaPromptCalled = true;
        return Promise.resolve();
      };
      ev.userChoice = Promise.resolve({ outcome });
      window.dispatchEvent(ev);
    },
    { outcome },
  );
}

test.describe("Phase D — PWA Install Promotion (top page only)", () => {
  test("/ で beforeinstallprompt 受信時にカスタム banner が表示される", async ({ page }) => {
    await page.goto("/");

    const banner = page.getByTestId("pwa-install-promotion");
    await expect(banner).toHaveCount(0);

    await dispatchBeforeInstallPrompt(page);

    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("ホーム画面に追加");
    await expect(page.getByTestId("pwa-install-accept")).toBeVisible();
    await expect(page.getByTestId("pwa-install-dismiss")).toBeVisible();
  });

  test("「ホーム画面に追加」 click → event.prompt() が起動し、accepted で banner が消える", async ({
    page,
  }) => {
    await page.goto("/");
    await dispatchBeforeInstallPrompt(page, { outcome: "accepted" });

    const banner = page.getByTestId("pwa-install-promotion");
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("pwa-install-accept").click();

    await expect(banner).toHaveCount(0);
    const promptCalled = await page.evaluate(
      () => (window as unknown as { __pwaPromptCalled?: boolean }).__pwaPromptCalled === true,
    );
    expect(promptCalled).toBe(true);

    // accepted 時は appinstalled 受信を待つ仕様のため、ここでは localStorage は書かれない。
    const dismissedAt = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      STORAGE_KEY,
    );
    expect(dismissedAt).toBeNull();
  });

  test("「今は閉じる」 click → banner が消え、localStorage に dismissedAt が書かれて 30 日 TTL に乗る", async ({
    page,
  }) => {
    await page.goto("/");
    await dispatchBeforeInstallPrompt(page, { outcome: "dismissed" });

    const banner = page.getByTestId("pwa-install-promotion");
    await expect(banner).toBeVisible({ timeout: 10_000 });

    const before = Date.now();
    await page.getByTestId("pwa-install-dismiss").click();
    await expect(banner).toHaveCount(0);

    const dismissedAtRaw = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      STORAGE_KEY,
    );
    expect(dismissedAtRaw).not.toBeNull();
    const dismissedAt = Number.parseInt(dismissedAtRaw ?? "0", 10);
    expect(dismissedAt).toBeGreaterThanOrEqual(before);

    // 同じ storage 状態のままリロード → 30 日 TTL 内なので listener が attach されず、
    // beforeinstallprompt を打っても banner は出ない。
    await page.reload();
    await dispatchBeforeInstallPrompt(page, { outcome: "dismissed" });
    await expect(banner).toHaveCount(0);
  });

  test("/login など非トップ画面では PwaInstallPromotion / IOsInstallHint いずれも mount されない", async ({
    page,
  }) => {
    await page.goto("/login");

    // Phase D で mount 点はトップ画面のみに限定。/login には付かない。
    await expect(page.getByTestId("pwa-install-promotion")).toHaveCount(0);
    await expect(
      page.getByRole("note").filter({ hasText: "ホーム画面に追加" }),
    ).toHaveCount(0);

    // 念のため beforeinstallprompt を dispatch しても何も起きないこと
    await page.evaluate(() => {
      const ev = new Event("beforeinstallprompt") as Event & {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
      };
      ev.prompt = () => Promise.resolve();
      ev.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(ev);
    });
    await expect(page.getByTestId("pwa-install-promotion")).toHaveCount(0);
  });
});

test.describe("Phase D — Service Worker static contract", () => {
  test("/sw.js が Phase D の invariant（CACHE_VERSION=v2 / allowlist / MAX_RUNTIME_ENTRIES / shouldCacheNavigate）を保持する", async ({
    request,
  }) => {
    const res = await request.get("/sw.js");
    expect(res.status()).toBe(200);

    const ct = res.headers()["content-type"] ?? "";
    expect(ct).toMatch(/javascript|text\/plain/);

    const body = await res.text();

    // CACHE_VERSION は Phase D で v1 → v2 に bump 済み
    expect(body).toMatch(/const\s+CACHE_VERSION\s*=\s*"v2"/);

    // navigate cache の path allowlist が "/" + "/login" のみ（auth-aware path 除外）
    expect(body).toContain("NAVIGATE_CACHE_ALLOWLIST");
    expect(body).toMatch(/NAVIGATE_CACHE_ALLOWLIST\s*=\s*\[\s*"\/"\s*,\s*"\/login"\s*\]/);

    // 簡易 LRU の上限定数（50 件で最古から間引き）
    expect(body).toContain("MAX_RUNTIME_ENTRIES");
    expect(body).toMatch(/MAX_RUNTIME_ENTRIES\s*=\s*50/);

    // navigate cache の write 直前で path 判定する関数が存在する
    expect(body).toContain("function shouldCacheNavigate");

    // 実際の write 経路で trimCache が呼ばれている（put → trim 順序）
    expect(body).toContain("trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES)");
  });
});
