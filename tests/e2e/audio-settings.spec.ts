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
 * Phase 4.9: Audio Notifications.
 *
 * PRD 02 polish (タブ化) でサウンド設定は独立ページから「設定」タブ内 Card に統合された。
 * 本 spec は同統合後の振る舞い前提で書かれている。旧 URL `/groups/[gid]/audio-settings`
 * は thin redirect で `/groups/[gid]?tab=settings` に転送される（`?from=` `?tid=` クエリ保持）。
 *
 * 検証対象:
 *   1. organizer は「設定」タブ内 Card で設定を変更・保存でき、Firestore の
 *      `groups/{gid}.audioSettings` に書込まれる。保存後は同一画面に留まる。
 *   2. 一般メンバーが旧 URL を踏むと redirect で `/groups/[gid]?tab=settings` に着地し、
 *      `AudioSettingsCard` 自体が render されない（親側 organizer gate）。
 *   3. dashboard で organizer は `SoundToggleButton` を確認できる。
 *      audioSettings.enabled=false に切替えると banner は非表示になる。
 *   4. `?from=live&tid=` 経由で開くと Card 内に「← 全画面表示へ戻る」が出て、
 *      保存後に `/tournaments/{tid}/live` に遷移する。
 *   5. `/live` で member は banner が出ない（operator gate）。
 *
 * 検証外:
 *   - 実際の音声再生（headless Chromium で `HTMLAudioElement.play` は autoplay
 *     policy で reject されることが多い）。Unit test (`useAudioPlayer.test.tsx`)
 *     でモック経由の play 呼出しを検証している。
 */

interface AudioSettingsSnapshot {
  enabled: boolean;
  levelUpSoundId: string;
  winnerSoundId: string;
  volume: number;
}

/**
 * Firestore Emulator REST API のドキュメントレスポンスから audioSettings を抽出。
 * REST 表現は `{ fields: { audioSettings: { mapValue: { fields: { ... } } } } }`。
 */
function readAudioSettings(doc: Record<string, unknown>): AudioSettingsSnapshot {
  const fields = (doc as { fields?: Record<string, unknown> }).fields ?? {};
  const audio = fields.audioSettings as
    | { mapValue?: { fields?: Record<string, unknown> } }
    | undefined;
  const inner = audio?.mapValue?.fields ?? {};
  const enabled = (inner.enabled as { booleanValue?: boolean } | undefined)?.booleanValue;
  const levelUpSoundId = (inner.levelUpSoundId as { stringValue?: string } | undefined)
    ?.stringValue;
  const winnerSoundId = (inner.winnerSoundId as { stringValue?: string } | undefined)
    ?.stringValue;
  // doubleValue は number、integerValue は string で来るので両対応する。
  const volRaw = inner.volume as
    | { doubleValue?: number; integerValue?: string }
    | undefined;
  const volume =
    typeof volRaw?.doubleValue === "number"
      ? volRaw.doubleValue
      : typeof volRaw?.integerValue === "string"
        ? Number(volRaw.integerValue)
        : Number.NaN;
  if (
    typeof enabled !== "boolean" ||
    typeof levelUpSoundId !== "string" ||
    typeof winnerSoundId !== "string" ||
    Number.isNaN(volume)
  ) {
    throw new Error(
      `audioSettings shape mismatch: ${JSON.stringify(inner)}`,
    );
  }
  return { enabled, levelUpSoundId, winnerSoundId, volume };
}

test.describe("Phase 4.9: audio settings (tab-integrated)", () => {
  test("organizer は設定タブの Card で設定を変更して保存でき、Firestore に反映される", async ({
    page,
    request,
    groupDetailPage,
  }) => {
    const organizer = randomOrganizer("audio-op");
    await registerOrganizer(page, organizer);
    const gid = await createGroup(page, "Audio Settings Group");

    // 初期 state: createGroup の `DEFAULT_AUDIO_SETTINGS` が書かれている前提。
    const before = await getDocument(request, `groups/${gid}`);
    expect(before.exists).toBe(true);
    const beforeSnap = readAudioSettings(before.data!);
    expect(beforeSnap).toEqual({
      enabled: true,
      levelUpSoundId: "default:blind-up",
      winnerSoundId: "default:victory-chime",
      volume: 0.7,
    });

    const detail = groupDetailPage(gid);
    await detail.goto();
    await detail.expectLoaded();
    await detail.selectTab("settings");
    await detail.expectAudioCardLoaded();

    // enabled を off → 音量 50% → 各 select は default のまま、保存。
    await detail.audioEnabledCheckbox.uncheck();
    // <Input type="range"> は fill での値入力を Playwright がサポートする。
    await detail.audioVolumeRange.fill("0.5");

    await detail.audioSaveButton.click();
    // 保存後は同一画面に留まり savedFlash「保存しました」が表示される（`?from=` 無し経路）。
    await expect(detail.audioSavedFlash).toBeVisible({ timeout: 10_000 });

    // Firestore 側に反映されたことを REST 直読みで検証。
    // emulator は rule を bypass する admin token で読めるので即時確認可能。
    await expect
      .poll(
        async () => {
          const snap = await getDocument(request, `groups/${gid}`);
          if (!snap.exists) return null;
          return readAudioSettings(snap.data!);
        },
        { timeout: 10_000 },
      )
      .toEqual({
        enabled: false,
        levelUpSoundId: "default:blind-up",
        winnerSoundId: "default:victory-chime",
        volume: 0.5,
      });
  });

  test("一般メンバーは旧 URL から /groups/[gid]?tab=settings にリダイレクトされ、Card は render されない", async ({
    page,
  }) => {
    // owner: group 作成 + 招待コード発行
    const owner = randomOrganizer("audio-ow");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Audio Member Gate");
    const inviteUrl = await issueInviteUrl(page, gid);

    // member: 別 context で加入 → 旧 audio-settings URL へ直接アクセス
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("audio-mb");
      await registerOrganizer(memberPage, member);
      const joinedGid = await consumeInviteUrl(memberPage, inviteUrl);
      expect(joinedGid).toBe(gid);

      await memberPage.goto(`/groups/${gid}/audio-settings`);
      // page.tsx の redirect で /groups/${gid}?tab=settings に着地
      await memberPage.waitForURL(
        new RegExp(`/groups/${gid}\\?.*tab=settings`),
        { timeout: 15_000 },
      );

      // 設定タブ panel は visible（読取専用 Card 群が見える）
      await expect(memberPage.locator("#group-detail-panel-settings")).toBeVisible();
      // 開催数（read-only 表示）は member にも見える
      await expect(memberPage.getByText("開催数")).toBeVisible();
      // ただしサウンド設定 Card は organizer gate により render されない（aria-label scope で判定）
      await expect(
        memberPage.locator('[aria-label="audio-settings-card"]'),
      ).toHaveCount(0);
    } finally {
      await memberCtx.close();
    }
  });

  test("dashboard の SoundToggleButton は organizer に表示され、enabled=false で OFF アイコンに切り替わる", async ({
    page,
    request,
    groupDetailPage,
    tournamentDashboardPage,
  }) => {
    // Phase 4.11: dashboard の SoundUnlockBanner は撤去され、TimerControls 内の
    // `SoundToggleButton` に集約された。SoundToggleButton は running/paused 状態でのみ
    // 描画されるため、tournament を running まで進めてから検証する。
    const organizer = randomOrganizer("audio-dash");
    await registerOrganizer(page, organizer);
    const gid = await createGroup(page, "Audio Dash Group");
    await createDefaultStructure(page, "Audio Dash Default");
    const tid = await createTournament(page, "Audio Dash Tournament");

    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({ timeout: 15_000 });
    await dash.startTournament();
    await expect(dash.stateBadge).toHaveText("進行中");

    // 初期状態: enabled=true。Phase 5.1: useImplicitAudioUnlock で実際の操作（dashboard
    // 内のクリック）を経て audio が unlock 済み → 「サウンドON（クリックでOFF）」アイコン。
    await expect(
      page.getByRole("button", { name: /^サウンドON/ }),
    ).toBeVisible({ timeout: 15_000 });

    // 設定タブで enabled を off にして保存（同一画面 polish 後経路）。
    const detail = groupDetailPage(gid);
    await detail.goto();
    await detail.expectLoaded();
    await detail.selectTab("settings");
    await detail.expectAudioCardLoaded();
    await detail.audioEnabledCheckbox.uncheck();
    await detail.audioSaveButton.click();
    await expect(detail.audioSavedFlash).toBeVisible({ timeout: 10_000 });

    // Firestore に enabled=false が落ちたことを確認してから dashboard を再訪。
    await expect
      .poll(async () => {
        const snap = await getDocument(request, `groups/${gid}`);
        return snap.exists ? readAudioSettings(snap.data!).enabled : null;
      })
      .toBe(false);

    await dash.goto();
    // running 状態は維持されている（state 遷移していない）。
    await expect(dash.stateBadge).toHaveText("進行中");
    // 「サウンドON」ボタンは消え、OFF アイコンに切り替わる。
    // Phase 4.13: settingsHref を廃止して `<Link>` → `<Button>` に変更し、
    // クリックで group の audioSettings.enabled を反転書込みする方式に変わった。
    await expect(
      page.getByRole("button", { name: /^サウンドON/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^サウンドOFF/ }),
    ).toBeVisible();
  });

  test("/live の SoundUnlockBanner には『設定』リンクが無い（Phase 4.13 で廃止）", async ({
    page,
  }) => {
    // Phase 4.13: 設定ページへの導線をサイドバー（「サウンド設定」）に集約したため、
    //   SoundUnlockBanner からは settings リンクを廃止。本テストはそのリグレッション
    //   ガードを兼ねる。`?from=live&tid=` クエリ自体は audio-settings page 側で
    //   引き続き解釈されるため、URL 直アクセスからの戻り先切替は別ケースで検証する。
    const organizer = randomOrganizer("audio-lban");
    await registerOrganizer(page, organizer);
    await createGroup(page, "Audio Live Banner");
    await createDefaultStructure(page, "Audio Live Banner Default");
    const tid = await createTournament(page, "Audio Live Banner Tournament");

    await page.goto(`/tournaments/${tid}/live`);

    // unlock CTA は表示される（organizer 兼 audioSettings.enabled=true デフォルト）
    await expect(
      page.getByRole("button", { name: /^サウンドを有効化$/ }),
    ).toBeVisible({ timeout: 15_000 });

    // 「設定」リンクは廃止された
    await expect(page.getByRole("link", { name: /^設定$/ })).toHaveCount(0);
  });

  test("audio-settings に ?from=live&tid= を直接渡すと redirect 後 Card 内に『全画面表示へ戻る』が出て、保存で /live に遷移する", async ({
    page,
    groupDetailPage,
  }) => {
    // Phase 4.13 で本 UI 経路（banner からのリンク）は無くなったが、`?from=live` 解釈は
    // タブ統合後も `AudioSettingsCard` で維持されている（将来の再導線追加に備える）。
    // page.tsx の redirect が `?from` `?tid` を保持して `?tab=settings` に転送する契約も同時に検証する。
    const organizer = randomOrganizer("audio-fl");
    await registerOrganizer(page, organizer);
    const gid = await createGroup(page, "Audio From Live");
    await createDefaultStructure(page, "Audio From Live Default");
    const tid = await createTournament(page, "Audio From Live Tournament");

    await page.goto(`/groups/${gid}/audio-settings?from=live&tid=${tid}`);
    // redirect で /groups/${gid}?tab=settings&from=live&tid=${tid} に着地（順序は緩く）
    await page.waitForURL(
      new RegExp(`/groups/${gid}\\?(?=.*tab=settings)(?=.*from=live)(?=.*tid=${tid})`),
      { timeout: 15_000 },
    );
    const detail = groupDetailPage(gid);
    await detail.expectAudioCardLoaded();

    await expect(detail.audioBackLink).toBeVisible();
    await expect(detail.audioBackLink).toHaveText(/全画面表示へ戻る/);

    await Promise.all([
      page.waitForURL(`**/tournaments/${tid}/live`, { timeout: 15_000 }),
      detail.audioSaveButton.click(),
    ]);
  });

  test("/live で organizer には『受付へ戻る』ボタンが表示され、member には表示されない", async ({
    page,
  }) => {
    const owner = randomOrganizer("audio-bk-lo");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Live Back Gate");
    await createDefaultStructure(page, "Live Back Default");
    const tid = await createTournament(page, "Live Back Tournament");
    const inviteUrl = await issueInviteUrl(page, gid);

    // owner 側: /live で『受付へ戻る』が見え、押すと dashboard に戻る
    await page.goto(`/tournaments/${tid}/live`);
    const backLink = page.getByRole("link", { name: /^受付へ戻る$/ });
    await expect(backLink).toBeVisible({ timeout: 15_000 });
    await Promise.all([
      page.waitForURL(`**/tournaments/${tid}`, { timeout: 15_000 }),
      backLink.click(),
    ]);

    // member 側: 同じ /live で『受付へ戻る』が見えない
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("audio-bk-mb");
      await registerOrganizer(memberPage, member);
      const joinedGid = await consumeInviteUrl(memberPage, inviteUrl);
      expect(joinedGid).toBe(gid);

      await memberPage.goto(`/tournaments/${tid}/live`);
      await expect(memberPage.locator("main")).toBeVisible();
      await expect(
        memberPage.getByRole("link", { name: /^受付へ戻る$/ }),
      ).toHaveCount(0);
    } finally {
      await memberCtx.close();
    }
  });

  test("/live で member には SoundUnlockBanner が表示されない", async ({ page }) => {
    const owner = randomOrganizer("audio-lo");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Audio Live Gate");
    await createDefaultStructure(page, "Audio Live Default");
    const tid = await createTournament(page, "Audio Live Tournament");
    const inviteUrl = await issueInviteUrl(page, gid);

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("audio-mb2");
      await registerOrganizer(memberPage, member);
      const joinedGid = await consumeInviteUrl(memberPage, inviteUrl);
      expect(joinedGid).toBe(gid);

      await memberPage.goto(`/tournaments/${tid}/live`);
      // /live 主要要素が描画されたことを wait（接続バッジ or main）。
      await expect(memberPage.locator("main")).toBeVisible();

      // member は audioRole === "member" → isAudioOperator=false で banner section
      // 自体が render されない。
      await expect(
        memberPage.getByRole("button", { name: /^サウンドを有効化$/ }),
      ).toHaveCount(0);
      await expect(memberPage.getByText("サウンド有効")).toHaveCount(0);
    } finally {
      await memberCtx.close();
    }
  });
});
