import { test, expect } from "./fixtures/test-context";
import { randomOrganizer, registerOrganizer } from "./fixtures/flows";

/**
 * Track D Phase D.1: テーマ切替（chic dark theme）の user-observable な振る舞いを E2E で検証する。
 *
 *   - `/settings` 画面に「テーマ」Card が出現し、radiogroup として操作可能
 *   - Dark / Light の選択が `<html>` の `.dark` class 反映と
 *     `localStorage["allinpt.theme"]` 永続化に同期する
 *   - リロード後も preference が保持される（hydrate 経路）
 *   - signed-out + OS が dark の場合に `<head>` 内 inline script
 *     （FOUC 防止）が初回 HTML 時点で `<html class="dark">` を立てる
 *
 * 観点として unit test では検証不能な「初回 HTML レスポンスから hydration までの
 * window で dark class が立つ」FOUC 経路を E2E で押さえるのが本 spec の主目的。
 * `/settings` は `RequireAuth(allowAnonymous)` で匿名でも到達可能だが、本 spec では
 * 実運用に近い signed-in organizer 経由で検証する。
 */

const STORAGE_KEY = "allinpt.theme";

test.describe("Track D: テーマ切替", () => {
  test("signed-in /settings の radiogroup から dark を選ぶと html.dark が付き、localStorage に永続化され、リロード後も保持される", async ({
    page,
  }) => {
    const organizer = randomOrganizer("theme");
    await registerOrganizer(page, organizer);

    await page.goto("/settings");

    // テーマ Card と radiogroup が visible（CardTitle "テーマ" + radiogroup aria-label "テーマ"）。
    // `<CardTitle>` は shadcn の素朴な `<div>` で heading role を持たないため、テキスト一致で確認する。
    await expect(page.getByText("テーマ", { exact: true })).toBeVisible();
    const radiogroup = page.getByRole("radiogroup", { name: "テーマ" });
    await expect(radiogroup).toBeVisible();

    // 3 つの radio が出ている
    const lightRadio = radiogroup.getByRole("radio", { name: "ライトモード" });
    const darkRadio = radiogroup.getByRole("radio", { name: "ダークモード" });
    const systemRadio = radiogroup.getByRole("radio", { name: "OS の設定に従う" });
    await expect(lightRadio).toBeVisible();
    await expect(darkRadio).toBeVisible();
    await expect(systemRadio).toBeVisible();

    // 初期は localStorage 未保存のため "system" がチェック状態（Playwright default は
    // light emulation のため html.dark は未付与）
    await expect(systemRadio).toHaveAttribute("aria-checked", "true");
    await expect(darkRadio).toHaveAttribute("aria-checked", "false");

    // ダーク選択 → html.dark が付く + localStorage に "dark"
    await darkRadio.click();
    await expect(darkRadio).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
    const storedDark = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      STORAGE_KEY,
    );
    expect(storedDark).toBe("dark");

    // リロード後も dark preference が保持される（hydrate 経路の検証）
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
    await expect(
      page.getByRole("radiogroup", { name: "テーマ" }).getByRole("radio", {
        name: "ダークモード",
      }),
    ).toHaveAttribute("aria-checked", "true");

    // ライト選択 → html.dark が外れる + localStorage に "light"
    await page
      .getByRole("radiogroup", { name: "テーマ" })
      .getByRole("radio", { name: "ライトモード" })
      .click();
    await expect(page.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/);
    const storedLight = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      STORAGE_KEY,
    );
    expect(storedLight).toBe("light");
  });

  test("FOUC 防止: signed-out + OS dark の context で初回 HTML レスポンスに inline script が含まれ、初回 paint で html.dark が立つ", async ({
    browser,
  }) => {
    // `prefers-color-scheme: dark` を context レベルで emulate。
    // localStorage は context 新規で空（→ inline script は "system" fallback → OS dark
    // 検出 → html.dark を hydration 前に付与）。
    const context = await browser.newContext({ colorScheme: "dark" });
    try {
      const page = await context.newPage();

      // 初回 HTML 取得時点で inline script が `<head>` に injection されていることを
      // raw HTML 検証で確かめる（page.goto 後の document.head は React 介入後の状態を
      // 反映するため、request 経由で raw HTML を取る）。
      const res = await page.request.get("/");
      expect(res.status()).toBe(200);
      const html = await res.text();
      // themeBootstrap IIFE の固有リテラル `allinpt.theme` が <script> タグ内に存在し、
      // `document.documentElement.classList.add("dark")` の経路が rendered HTML に含まれる
      // ことで、FOUC 防止 inline script の injection を検証する（最小限の string match）。
      expect(html).toContain("allinpt.theme");
      expect(html).toContain(`document.documentElement.classList.add("dark")`);

      // 実際に goto して描画。inline script は hydration 前に同期で走るため、最初の
      // 評価機会で `<html class="dark">` が立っている（colorScheme: "dark" emulation）。
      await page.goto("/");
      await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
    } finally {
      await context.close();
    }
  });

  test("FOUC 防止: signed-out + OS light の context では html.dark が付かない（negative 検証）", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    try {
      const page = await context.newPage();
      await page.goto("/");
      // localStorage 未保存 + system + OS light → html.dark は付与されない
      await expect(page.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/);
    } finally {
      await context.close();
    }
  });
});
