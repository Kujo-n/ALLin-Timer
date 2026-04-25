import { test, expect } from "./fixtures/test-context";
import { getDocument } from "./fixtures/emulator";
import {
  consumeInviteUrl,
  createDefaultStructure,
  createGroup,
  createTournament,
  issueInviteUrl,
  randomOrganizer,
  registerOrganizer,
} from "./fixtures/flows";

/**
 * Phase 4.13: ナビ刷新（sidebar / mobile Sheet）+ SoundToggleButton in-place toggle。
 *
 * 検証対象:
 *   1. PrimaryNav の role / signedIn ベースの表示制御
 *      - signed-out: ホームのみ
 *      - organizer + currentGroupId: サウンド設定 visible
 *      - member + currentGroupId: サウンド設定 hidden
 *   2. /tournaments/{tid}/live の fullscreen pattern（sidebar 非表示）
 *   3. dashboard SoundToggleButton OFF → クリック → Firestore audioSettings.enabled が反転
 *      （Phase 4.13 で settingsHref 廃止 → in-place 書込みに変更）
 *   4. mobile viewport: hamburger → Sheet 開閉、ナビゲーションで自動クローズ
 *
 * 検証外:
 *   - Sidebar の visual layout / 等高化（unit test 領域）
 *   - audio 詳細設定（audio-settings.spec.ts でカバー）
 */

const SIDEBAR_LABEL = "メインナビゲーション";

interface AudioSettingsSnapshot {
  enabled: boolean;
}

/**
 * Firestore Emulator REST API のレスポンスから audioSettings.enabled のみ抽出。
 * 詳細形は audio-settings.spec.ts を参照（ここでは enabled の真偽値だけ見れば十分）。
 */
function readAudioEnabled(doc: Record<string, unknown>): AudioSettingsSnapshot {
  const fields = (doc as { fields?: Record<string, unknown> }).fields ?? {};
  const audio = fields.audioSettings as
    | { mapValue?: { fields?: Record<string, unknown> } }
    | undefined;
  const inner = audio?.mapValue?.fields ?? {};
  const enabled = (inner.enabled as { booleanValue?: boolean } | undefined)?.booleanValue;
  if (typeof enabled !== "boolean") {
    throw new Error(`audioSettings.enabled missing: ${JSON.stringify(inner)}`);
  }
  return { enabled };
}

test.describe("Phase 4.13: nav shell", () => {
  test("signed-out: sidebar は『ホーム』のみで authOnly 項目は隠れる", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.getByRole("complementary", { name: SIDEBAR_LABEL });
    await expect(sidebar).toBeVisible();

    // ホームは authOnly: false なので signed-out でも見える
    await expect(sidebar.getByRole("link", { name: "ホーム" })).toBeVisible();
    // authOnly: true の項目はすべて隠れる
    await expect(sidebar.getByRole("link", { name: "サークル" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "トーナメント" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "ストラクチャ" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "テンプレート" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "サウンド設定" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "アカウント設定" })).toHaveCount(0);
  });

  test("organizer + currentGroupId: 全 authOnly 項目 + サウンド設定 が見え、active 状態が aria-current で示される", async ({
    page,
  }) => {
    const organizer = randomOrganizer("nav-op");
    await registerOrganizer(page, organizer);
    const gid = await createGroup(page, "Nav Org Group");

    // /groups/[gid] に遷移済み。currentGroupId は createGroup 後に gid が選ばれている。
    const sidebar = page.getByRole("complementary", { name: SIDEBAR_LABEL });
    await expect(sidebar).toBeVisible();

    // authOnly 項目すべて + サウンド設定（organizer && currentGroupId）が表示
    for (const label of [
      "ホーム",
      "サークル",
      "トーナメント",
      "ストラクチャ",
      "テンプレート",
      "サウンド設定",
      "アカウント設定",
    ]) {
      await expect(sidebar.getByRole("link", { name: label })).toBeVisible();
    }

    // 現在 path /groups/{gid} ではサブ link（group 名）のみが active になり、
    // 親「サークル」link は aria-current を持たない（ARIA 12 重複回避）。
    const groupsLink = sidebar.getByRole("link", { name: "サークル" });
    await expect(groupsLink).not.toHaveAttribute("aria-current", "page");
    const groupSubLink = sidebar.getByRole("link", { name: "Nav Org Group" });
    await expect(groupSubLink).toHaveAttribute("aria-current", "page");

    // サウンド設定の href は /groups/{gid}/audio-settings に解決される
    const audioLink = sidebar.getByRole("link", { name: "サウンド設定" });
    await expect(audioLink).toHaveAttribute("href", `/groups/${gid}/audio-settings`);
  });

  test("一般メンバー: sidebar に『サウンド設定』が出ない（organizer gate）", async ({ page }) => {
    const owner = randomOrganizer("nav-ow");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Nav Member Gate");
    const inviteUrl = await issueInviteUrl(page, gid);

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("nav-mb");
      await registerOrganizer(memberPage, member);
      await consumeInviteUrl(memberPage, inviteUrl);

      // group 加入後の /groups/[gid] で sidebar を確認
      const sidebar = memberPage.getByRole("complementary", { name: SIDEBAR_LABEL });
      await expect(sidebar).toBeVisible();
      // メンバー視点でも他の authOnly 項目は出る
      await expect(sidebar.getByRole("link", { name: "サークル" })).toBeVisible();
      await expect(sidebar.getByRole("link", { name: "トーナメント" })).toBeVisible();
      // サウンド設定だけは hidden
      await expect(sidebar.getByRole("link", { name: "サウンド設定" })).toHaveCount(0);
    } finally {
      await memberCtx.close();
    }
  });

  test("/tournaments/{tid}/live: fullscreen pattern により sidebar が消える", async ({ page }) => {
    const organizer = randomOrganizer("nav-fs");
    await registerOrganizer(page, organizer);
    await createGroup(page, "Nav Fullscreen Group");
    await createDefaultStructure(page, "Nav Fullscreen Default");
    const tid = await createTournament(page, "Nav Fullscreen Tournament");

    // dashboard では sidebar が出る
    await page.goto(`/tournaments/${tid}`);
    await expect(
      page.getByRole("complementary", { name: SIDEBAR_LABEL }),
    ).toBeVisible({ timeout: 15_000 });

    // /live では sidebar 自体が描画されない（AppShell の早期 return）
    await page.goto(`/tournaments/${tid}/live`);
    await expect(page.locator("main")).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: SIDEBAR_LABEL }),
    ).toHaveCount(0);
  });

  test("mobile viewport: hamburger → Sheet 開閉、ナビ選択で自動クローズ", async ({ page }) => {
    // Tailwind `md:` breakpoint = 768px。640x900 なら `md:hidden` の hamburger が出て、
    // `md:block` の sidebar は隠れる。
    await page.setViewportSize({ width: 640, height: 900 });

    const organizer = randomOrganizer("nav-mob");
    await registerOrganizer(page, organizer);
    await createGroup(page, "Nav Mobile Group");

    // モバイル幅なので desktop sidebar は非表示
    await expect(
      page.getByRole("complementary", { name: SIDEBAR_LABEL }),
    ).toHaveCount(0);

    // hamburger（aria-label="メニューを開く"）が見える
    const opener = page.getByRole("button", { name: "メニューを開く" });
    await expect(opener).toBeVisible();
    await expect(opener).toHaveAttribute("aria-expanded", "false");

    // クリックで Sheet が開く。Radix Dialog は `<SheetTitle>` を aria-labelledby で
    // 参照するため、accessible name は SheetContent の aria-label ではなく
    // SheetTitle のテキスト「メニュー」になる。
    //
    // Sheet 開放中は Radix の focus trap によりトリガー側の aria-label/expanded を
    // 直接取得しても accessibility tree では masking されるため、Sheet の visibility と
    // 自動クローズの挙動のみで検証する（unit-test 領域に近い属性検査は省略）。
    await opener.click();
    const sheet = page.getByRole("dialog", { name: "メニュー" });
    await expect(sheet).toBeVisible();

    // Sheet 内のナビ項目をクリック → 別ページ遷移 + Sheet 自動クローズ
    await Promise.all([
      page.waitForURL("**/tournaments", { timeout: 15_000 }),
      sheet.getByRole("link", { name: "トーナメント" }).click(),
    ]);
    await expect(page.getByRole("dialog", { name: "メニュー" })).toHaveCount(0);
  });
});

test.describe("Phase 4.13: SoundToggleButton in-place toggle", () => {
  test("dashboard で OFF をクリックすると group の audioSettings.enabled が true に flip する", async ({
    page,
    request,
    groupAudioSettingsPage,
    tournamentDashboardPage,
  }) => {
    // 前提: organizer 登録 → group → structure → tournament（setup）→ running 化。
    // SoundToggleButton は running/paused 状態でしか描画されない。
    const organizer = randomOrganizer("nav-tg");
    await registerOrganizer(page, organizer);
    const gid = await createGroup(page, "Nav Toggle Group");
    await createDefaultStructure(page, "Nav Toggle Default");
    const tid = await createTournament(page, "Nav Toggle Tournament");

    // 先に audioSettings.enabled=false に倒しておき、dashboard で OFF アイコンを観測する。
    const audioPage = groupAudioSettingsPage(gid);
    await audioPage.goto();
    await audioPage.expectLoaded();
    await audioPage.enabledCheckbox.uncheck();
    await Promise.all([
      page.waitForURL(`**/groups/${gid}`, { timeout: 15_000 }),
      audioPage.saveButton.click(),
    ]);
    await expect
      .poll(async () => {
        const snap = await getDocument(request, `groups/${gid}`);
        return snap.exists ? readAudioEnabled(snap.data!).enabled : null;
      })
      .toBe(false);

    // running まで進める
    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({ timeout: 15_000 });
    await dash.startTournament();
    await expect(dash.stateBadge).toHaveText("running");

    // OFF アイコンが見えることを確認してクリック
    const offBtn = page.getByRole("button", { name: /^サウンドOFF/ });
    await expect(offBtn).toBeVisible({ timeout: 15_000 });
    await offBtn.click();

    // Firestore に enabled=true が反映される
    await expect
      .poll(
        async () => {
          const snap = await getDocument(request, `groups/${gid}`);
          return snap.exists ? readAudioEnabled(snap.data!).enabled : null;
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    // 既知ギャップ: dashboard の `tournamentGroup` は GroupProvider の one-shot 読込で
    // onSnapshot 購読していないため、in-place 書込み直後は UI が古い値のまま。
    // realistic な refresh 経路（リロード or 再ナビゲート）後に UI が
    // "サウンドを有効化" CTA に切替わることを確認する。
    await page.reload();
    await expect(dash.stateBadge).toHaveText("running", { timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /^サウンドを有効化$/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^サウンドOFF/ })).toHaveCount(0);
  });
});
