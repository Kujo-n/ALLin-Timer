import { test, expect } from "./fixtures/test-context";
import {
  createGroup,
  createTemplateViaUI,
  randomOrganizer,
  registerOrganizer,
} from "./fixtures/flows";

/**
 * Phase 4.8: Structure Template Library。
 *
 * 対象 UX:
 *   - `/templates` 一覧 / 空状態 / 作成 → 一覧反映
 *   - 自分のテンプレの編集・削除
 *   - 他人のテンプレは read のみ（編集 / 削除ボタン非表示）
 *   - `/structures/new` の TemplatePicker からフォームにテンプレ値が反映される
 *
 * 注意:
 *  - テンプレは group 非依存のため、一覧 / 新規 / 編集は group 作成不要。
 *  - `/structures/new` だけは organizer + currentGroupId を要するため
 *    Test 5 のみ group を先に作る。
 *  - rule 側では `/templates` read は isSignedIn で通る（匿名不可は UI 側 `RequireAuth`）。
 */

test.describe("Phase 4.8: Structure Template Library", () => {
  test("create → list: 新規テンプレが一覧に表示される", async ({ page }) => {
    const organizer = randomOrganizer("tpl");
    await registerOrganizer(page, organizer);

    await page.goto("/templates");
    await expect(
      page.getByText("まだテンプレートがありません。"),
    ).toBeVisible();

    await page.getByRole("link", { name: /^新規作成$/ }).click();
    await page.waitForURL("**/templates/new", { timeout: 10_000 });

    await page.getByLabel("テンプレート名").fill("Standard 20min");
    await page.getByLabel("説明（任意）").fill("20 分 × 15 レベル想定");
    await Promise.all([
      page.waitForURL("**/templates", { timeout: 15_000 }),
      page.getByRole("button", { name: /^作成$/ }).click(),
    ]);

    // 一覧に card が 1 件表示され、名前 / 説明 / 作成者が見える
    await expect(page.getByText("Standard 20min")).toBeVisible();
    await expect(page.getByText("20 分 × 15 レベル想定")).toBeVisible();
    await expect(
      page.getByText(`作成者: ${organizer.displayName}`),
    ).toBeVisible();
    // 自分のテンプレなので編集・削除ボタンが見える
    await expect(page.getByRole("button", { name: /^編集$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^削除$/ })).toBeVisible();
  });

  test("edit: 自分のテンプレの名前を変更すると一覧に反映される", async ({ page }) => {
    const organizer = randomOrganizer("tpl-ed");
    await registerOrganizer(page, organizer);
    await createTemplateViaUI(page, { name: "Before Edit" });

    await page.getByRole("button", { name: /^編集$/ }).click();
    await page.waitForURL(/\/templates\/[^/]+\/edit$/, { timeout: 10_000 });

    // 既存値がフォームに初期化されている
    await expect(page.getByLabel("テンプレート名")).toHaveValue("Before Edit");

    await page.getByLabel("テンプレート名").fill("After Edit");
    await Promise.all([
      page.waitForURL("**/templates", { timeout: 15_000 }),
      page.getByRole("button", { name: /^更新$/ }).click(),
    ]);

    await expect(page.getByText("After Edit")).toBeVisible();
    await expect(page.getByText("Before Edit")).toHaveCount(0);
  });

  test("delete: 自分のテンプレを削除すると一覧から消える", async ({ page }) => {
    const organizer = randomOrganizer("tpl-de");
    await registerOrganizer(page, organizer);
    await createTemplateViaUI(page, { name: "Kill Me" });

    await expect(page.getByText("Kill Me")).toBeVisible();

    // カードの削除ボタン → 確認 Dialog → 確定
    await page.getByRole("button", { name: /^削除$/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("削除しますか？")).toBeVisible();
    await dialog.getByRole("button", { name: /^削除$/ }).click();

    await expect(page.getByText("Kill Me")).toHaveCount(0);
    await expect(
      page.getByText("まだテンプレートがありません。"),
    ).toBeVisible();
  });

  test("他人のテンプレは一覧で read できるが編集・削除ボタンは非表示", async ({
    page,
  }) => {
    // userA: 作成者
    const userA = randomOrganizer("tpl-A");
    await registerOrganizer(page, userA);
    await createTemplateViaUI(page, {
      name: "Shared Template",
      description: "共有ひな形",
    });

    // userB: 別 context で参照
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const ctxB = await browser.newContext();
    try {
      const pageB = await ctxB.newPage();
      const userB = randomOrganizer("tpl-B");
      await registerOrganizer(pageB, userB);

      await pageB.goto("/templates");

      // 他人の doc も一覧に表示される（rule: isSignedIn で read 可）
      await expect(pageB.getByText("Shared Template")).toBeVisible();
      await expect(pageB.getByText("共有ひな形")).toBeVisible();
      await expect(
        pageB.getByText(`作成者: ${userA.displayName}`),
      ).toBeVisible();

      // 編集・削除ボタンは出ない（非管理者 / 非作成者）
      await expect(pageB.getByRole("button", { name: /^編集$/ })).toHaveCount(0);
      await expect(pageB.getByRole("button", { name: /^削除$/ })).toHaveCount(0);
    } finally {
      await ctxB.close();
    }
  });

  test("picker: /structures/new でテンプレを選ぶとフォームに値が反映される", async ({
    page,
  }) => {
    const organizer = randomOrganizer("tpl-pk");
    await registerOrganizer(page, organizer);

    // テンプレ作成（初期スタックを default 10000 から変えて差分を検証可能にする）
    await createTemplateViaUI(page, {
      name: "Picker Source",
      initialStack: 30000,
    });

    // /structures/new は organizer + currentGroupId 必須
    await createGroup(page, "Picker Group");

    await page.goto("/structures/new");

    // picker が読込み完了するまで待つ（読込中の表示が消えるのを待つ）
    const pickerSection = page.getByRole("region", { name: "テンプレート選択" });
    await expect(pickerSection).toBeVisible({ timeout: 15_000 });
    await expect(pickerSection.getByText("Picker Source")).toBeVisible();

    await pickerSection
      .getByRole("button", { name: "このテンプレを使う" })
      .click();

    // form key bump により initialValue を受けて再初期化される
    await expect(page.getByLabel("ストラクチャ名")).toHaveValue("Picker Source");
    await expect(page.getByLabel("初期スタック")).toHaveValue("30000");
  });
});
