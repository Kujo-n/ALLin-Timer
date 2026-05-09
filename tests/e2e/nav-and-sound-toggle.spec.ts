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
 *   2. /tournaments/{tid}/live でも sidebar / hamburger が機能する
 *      （旧 fullscreen pattern は廃止。一般参加者が画面を閉じても戻れる導線を提供）
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
    // authOnly: true の項目はすべて隠れる（Phase 4.14 で label rename）
    await expect(sidebar.getByRole("link", { name: "サークル一覧" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "トーナメント一覧" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "ストラクチャ" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "テンプレート" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "アカウント設定" })).toHaveCount(0);
  });

  test("organizer + currentGroupId: 全 authOnly 項目が見え、active 状態が aria-current で示される", async ({
    page,
  }) => {
    const organizer = randomOrganizer("nav-op");
    await registerOrganizer(page, organizer);
    await createGroup(page, "Nav Org Group");

    // /groups/[gid] に遷移済み。currentGroupId は createGroup 後に gid が選ばれている。
    const sidebar = page.getByRole("complementary", { name: SIDEBAR_LABEL });
    await expect(sidebar).toBeVisible();

    // authOnly 項目すべてが表示される
    // Phase 4.14: 「サークル」/「トーナメント」を「サークル一覧」/「トーナメント一覧」に rename
    // PRD 02 polish: 「サウンド設定」エントリ廃止（サークル詳細「設定」タブに集約）
    //
    // `exact: true`: サイドバー footer の user プロファイル link は accessible name に
    // `${userLabel}（アカウント設定を開く）` が入り「アカウント設定」を含むため、partial
    // match だとナビ項目「アカウント設定」と二重マッチして strict-mode 違反になる。
    for (const label of [
      "ホーム",
      "サークル一覧",
      "トーナメント一覧",
      "ストラクチャ",
      "テンプレート",
      "アカウント設定",
    ]) {
      await expect(
        sidebar.getByRole("link", { name: label, exact: true }),
      ).toBeVisible();
    }

    // 現在 path /groups/{gid} ではサブ link（group 名）のみが active になり、
    // 親「サークル一覧」link は aria-current を持たない（ARIA 12 重複回避）。
    const groupsLink = sidebar.getByRole("link", { name: "サークル一覧" });
    await expect(groupsLink).not.toHaveAttribute("aria-current", "page");
    const groupSubLink = sidebar.getByRole("link", { name: "Nav Org Group" });
    await expect(groupSubLink).toHaveAttribute("aria-current", "page");
  });

  test("PRD 02 polish: 全ロールの sidebar に『サウンド設定』 link が無い（タブ集約後の regression guard）", async ({
    page,
  }) => {
    const owner = randomOrganizer("nav-ow");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Nav Sound Guard");
    const inviteUrl = await issueInviteUrl(page, gid);

    // organizer 視点でも sidebar に「サウンド設定」 link が存在しない
    const ownerSidebar = page.getByRole("complementary", { name: SIDEBAR_LABEL });
    await expect(ownerSidebar).toBeVisible();
    await expect(
      ownerSidebar.getByRole("link", { name: "サウンド設定", exact: true }),
    ).toHaveCount(0);

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("nav-mb");
      await registerOrganizer(memberPage, member);
      await consumeInviteUrl(memberPage, inviteUrl);

      // member 視点でも同じく無い
      const memberSidebar = memberPage.getByRole("complementary", { name: SIDEBAR_LABEL });
      await expect(memberSidebar).toBeVisible();
      await expect(memberSidebar.getByRole("link", { name: "サークル一覧" })).toBeVisible();
      await expect(
        memberSidebar.getByRole("link", { name: "サウンド設定", exact: true }),
      ).toHaveCount(0);
    } finally {
      await memberCtx.close();
    }
  });

  test("/tournaments/{tid}/live でも sidebar が出て hamburger で切替できる", async ({ page }) => {
    // tmp/13_Phase5_memo.md「トーナメント参加者が /live でハンバーガーを押しても反応しない」
    // 対応で fullscreen pattern を廃止。dashboard と同じく sidebar / Sheet を render する。
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

    // /live でも sidebar が描画される（旧 fullscreen pattern は廃止）
    await page.goto(`/tournaments/${tid}/live`);
    await expect(
      page.getByRole("complementary", { name: SIDEBAR_LABEL }),
    ).toBeVisible({ timeout: 15_000 });

    // ハンバーガーで desktop sidebar を折りたためる（aria-expanded が反転する）
    const opener = page.getByRole("button", { name: /^メニューを(開く|閉じる)$/ });
    await expect(opener).toHaveAttribute("aria-expanded", "true");
    await opener.click();
    await expect(opener).toHaveAttribute("aria-expanded", "false");
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
      sheet.getByRole("link", { name: "トーナメント一覧" }).click(),
    ]);
    await expect(page.getByRole("dialog", { name: "メニュー" })).toHaveCount(0);
  });
});

test.describe("Phase 4.13: SoundToggleButton in-place toggle", () => {
  test("dashboard で OFF をクリックすると group の audioSettings.enabled が true に flip する", async ({
    page,
    request,
    groupDetailPage,
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
    // PRD 02 polish (タブ化) 後: サウンド設定はサークル詳細「設定」タブ内 Card に統合。
    const detail = groupDetailPage(gid);
    await detail.goto();
    await detail.expectLoaded();
    await detail.selectTab("settings");
    await detail.expectAudioCardLoaded();
    await detail.audioEnabledCheckbox.uncheck();
    await detail.audioSaveButton.click();
    await expect(detail.audioSavedFlash).toBeVisible({ timeout: 10_000 });
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
    await expect(dash.stateBadge).toHaveText("進行中");

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

    // Phase 4.14: refreshGroups() を toggle 成功後に呼ぶようになったため、
    // reload なしで UI が CTA に切替わる。
    // Phase 5.1: useImplicitAudioUnlock により最初のユーザー操作で audio が unlock 済みに
    // なっているため、enable 後の状態は「サウンドを有効化」(amber) ではなく
    // 「サウンドON（クリックでOFF）」(green) になる。
    await expect(dash.stateBadge).toHaveText("進行中", { timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /^サウンドON/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^サウンドOFF/ })).toHaveCount(0);
  });
});

test.describe("Phase 4.14: 開催中トーナメントのサイドバーサブナビ", () => {
  test("running 状態のトーナメントがサイドバーにサブリンクとして表示され、クリックで遷移する", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("nav-sub");
    await registerOrganizer(page, organizer);
    await createGroup(page, "Nav Subnav Group");
    await createDefaultStructure(page, "Nav Subnav Default");
    const tid = await createTournament(page, "Nav Subnav Tournament");

    // running まで進める。startTournament が "進行中" バッジを待機する。
    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({ timeout: 15_000 });
    await dash.startTournament();

    // サイドバー内に当該 tournament 名のサブリンクが realtime で現れる。
    // Phase 5.1: owner 自己参加で `JoinedTournamentsNav` も同名のリンク（href は /live）
    // を出すため、href 完全一致でフィルタして PrimaryNav 側のサブリンクだけを掴む。
    const sidebar = page.getByRole("complementary", { name: SIDEBAR_LABEL });
    const subLink = sidebar.locator(`a[href="/tournaments/${tid}"]`).filter({
      hasText: /Nav Subnav Tournament/,
    });
    await expect(subLink).toBeVisible({ timeout: 15_000 });
    await expect(subLink).toHaveAttribute("href", `/tournaments/${tid}`);

    // 別ページから戻ってきても active 判定は機能（サブリンクが aria-current=page）
    await page.goto("/tournaments");
    await expect(subLink).toBeVisible();
    await Promise.all([
      page.waitForURL(`**/tournaments/${tid}`, { timeout: 15_000 }),
      subLink.click(),
    ]);
    await expect(subLink).toHaveAttribute("aria-current", "page");
  });
});
