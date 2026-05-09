import { expect, test } from "./fixtures/test-context";
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
 * 04-spectate-mode 観戦モードの user flow を検証する E2E。
 *
 * PRD Must 項目で unit / emulator では検証できない user-observable な振る舞いを集約する:
 *   1. organizer が dashboard で toggle ON（確認 dialog 経由）→ Firestore 反映 → URL 表示
 *   2. **新規 anon browser context** で `/spectate/[tid]` を開いて、ログイン無しで
 *      タイマー / late-entry banner / tournament 名が表示される
 *   3. organizer 側で toggle OFF → anon 側が「観戦が終了しました」graceful 遷移
 *   4. `/tournaments` 一覧で `aria-label` に「・観戦公開中」が合成され badge が visible
 *   5. **member ロール**で dashboard を訪問 → `/live` redirect で SpectateModeCard を踏まない
 *      （MEDIUM-1: dashboard 統合の role gate を E2E で固定）
 *
 * 検証外（既存 unit でカバー）:
 *   - SpectateModeCard 単体の OFF/ON 表示分岐 / dialog flow / clipboard / QR 開閉
 *   - subscribe permission-denied の AppError code 経路
 *   - rule の allow/deny matrix（emulator validator が 19 ケース網羅済み）
 *
 * 起動コスト最適化のため、可能な限り 1 spec で複数の振る舞いを連鎖検証する。
 * `fullyParallel: false` / `workers: 1` なので spec 間の order は決定的。
 */

const SPECTATE_TOGGLE = "観戦モードを切り替え";
const SPECTATE_CONFIRM_ON = "ON にする";
const SPECTATE_BADGE_LABEL = "観戦モード公開中";

test.describe("04-spectate-mode — observer flow", () => {
  test("organizer toggle ON → anon が /spectate を開ける → toggle OFF で graceful 遷移 → 一覧 badge 出現", async ({
    page,
    tournamentDashboardPage,
  }) => {
    // ── Setup: organizer + group + tournament(setup) ───────────────────────
    const owner = randomOrganizer("spec-own");
    await registerOrganizer(page, owner);
    await createGroup(page, "Spectate Group");
    await createDefaultStructure(page, "Spectate Default");
    const tid = await createTournament(page, "Spectate Tournament");

    const dash = tournamentDashboardPage(tid);
    await dash.goto();

    // ── Phase 3: SpectateModeCard が visible で OFF 状態（PRD: organizer 経路） ──
    const toggleSwitch = page.getByRole("switch", { name: SPECTATE_TOGGLE });
    await expect(toggleSwitch).toBeVisible({ timeout: 15_000 });
    await expect(toggleSwitch).not.toBeChecked();

    // OFF 状態では URL / コピー / QR は非表示。
    await expect(
      page.getByRole("button", { name: "観戦 URL をコピー" }),
    ).toHaveCount(0);

    // ── 確認 dialog 経由でのみ ON が反映される（誤公開防止） ────────────────
    await toggleSwitch.click();
    const confirmDialog = page.getByRole("dialog", {
      name: "観戦モードを ON にしますか？",
    });
    await expect(confirmDialog).toBeVisible({ timeout: 10_000 });
    await confirmDialog.getByRole("button", { name: SPECTATE_CONFIRM_ON }).click();

    // dialog 閉じ + switch checked + URL コピー / QR ボタンが現れる
    await expect(confirmDialog).toHaveCount(0, { timeout: 10_000 });
    await expect(toggleSwitch).toBeChecked({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "観戦 URL をコピー" }),
    ).toBeVisible({ timeout: 10_000 });

    // URL 表示テキスト（mono 部分）に `/spectate/<tid>` が含まれる。
    // `page.locator('text=...')` は前方が `/` のとき regex として解釈されるため、
    // `getByText` の substring match で固定する。
    await expect(page.getByText(`/spectate/${tid}`).first()).toBeVisible();

    // ── /tournaments 一覧で badge が出る（aria-label 合成 + テキスト） ────
    await page.goto("/tournaments");
    const card = page
      .getByRole("group")
      .filter({ hasText: "Spectate Tournament" });
    await expect(card).toBeVisible({ timeout: 15_000 });
    // aria-label に「・観戦公開中」が含まれる（state ラベルは setup なので「未開催・観戦公開中」）
    const ariaLabel = await card.getAttribute("aria-label");
    expect(ariaLabel).toContain("観戦公開中");
    // 視認 badge も visible
    await expect(card.getByLabel(SPECTATE_BADGE_LABEL)).toBeVisible();

    // ── 別 anon context（cookie / storage 完全クリーン）で /spectate を開く ──
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const anonCtx = await browser.newContext();
    try {
      const anonPage = await anonCtx.newPage();
      await anonPage.goto(`/spectate/${tid}`);

      // タイマー section（aria-label="タイマー"）が visible になることで
      // anon read が rule 経路で allow されたことを user-observable に確認する。
      await expect(
        anonPage.getByRole("region", { name: "タイマー" }),
      ).toBeVisible({ timeout: 30_000 });

      // tournament 名が heading に出る
      await expect(
        anonPage.getByRole("heading", { name: "Spectate Tournament" }),
      ).toBeVisible();

      // setup 状態 → late entry banner は「受付準備中（開始前）」で表示される
      await expect(anonPage.getByText("受付準備中（開始前）")).toBeVisible();

      // ── organizer が toggle OFF → anon 側 graceful 遷移 ──────────────────
      // organizer 側 dashboard に戻って switch を OFF（OFF は確認 dialog 不要 / 即時）
      await dash.goto();
      const off = page.getByRole("switch", { name: SPECTATE_TOGGLE });
      await expect(off).toBeChecked({ timeout: 15_000 });
      await off.click();
      await expect(off).not.toBeChecked({ timeout: 15_000 });

      // anon 側 — 永続 onSnapshot listener 経由で permission-denied → 「観戦が終了しました」
      await expect(
        anonPage.getByRole("heading", { name: "観戦が終了しました" }),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await anonCtx.close();
    }
  });

  test("spectateEnabled=false の tournament を anon で /spectate に開くと「観戦が公開されていません」", async ({
    page,
  }) => {
    // organizer が toggle 一切しないまま、anon が URL を直叩きするケース。
    // rule で tournament 自体が anon read deny → spectate-client は読込中 → 永続 deny
    // からの guard ladder 経由で「観戦が公開されていません」 or 「観戦が終了しました」へ遷移。
    const owner = randomOrganizer("spec-off");
    await registerOrganizer(page, owner);
    await createGroup(page, "Spectate Off Group");
    await createDefaultStructure(page, "Spectate Off Default");
    const tid = await createTournament(page, "Spectate Off Tournament");

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const anonCtx = await browser.newContext();
    try {
      const anonPage = await anonCtx.newPage();
      await anonPage.goto(`/spectate/${tid}`);

      // 観戦未公開時は spectate-client の guard ladder で 2 種類のいずれかに着地する:
      //   - spectate-client が tournament を読めずに subscribe error → 「観戦が終了しました」
      //   - tournament 自体は読めず未定義のまま → 「観戦が公開されていません」（読込中タイムアウト）
      // 実装上は subscribePlayers/subscribeTables の onError が permission-denied で発火するため、
      // graceful な「観戦が終了しました」に着地するのが現状。どちらの heading でも PRD 要件
      //（auth flash / white screen にならない）を満たすため OR で許容する。
      const ended = anonPage.getByRole("heading", { name: "観戦が終了しました" });
      const notPublished = anonPage.getByRole("heading", {
        name: "観戦が公開されていません",
      });
      await expect(ended.or(notPublished)).toBeVisible({ timeout: 30_000 });
    } finally {
      await anonCtx.close();
    }
  });

  test("member ロールでは dashboard が /live に redirect されるため SpectateModeCard を踏まない (MEDIUM-1)", async ({
    page,
  }) => {
    // setup: owner (context A) → group + tournament + 招待コード
    const owner = randomOrganizer("spec-own2");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Spec Role Group");
    await createDefaultStructure(page, "Spec Role Default");
    const tid = await createTournament(page, "Spec Role Tournament");
    const inviteUrl = await issueInviteUrl(page, gid);

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("spec-mem");
      await registerOrganizer(memberPage, member);
      await consumeInviteUrl(memberPage, inviteUrl);

      // member が dashboard を URL 直叩き → /live に redirect される
      await memberPage.goto(`/tournaments/${tid}`);
      await memberPage.waitForURL(`**/tournaments/${tid}/live`, {
        timeout: 15_000,
      });

      // 副次効果: redirect 後の /live には SpectateModeCard が無い（observable な
      // 「member が toggle UI を踏めない」の機械検証）
      await expect(
        memberPage.getByRole("switch", { name: SPECTATE_TOGGLE }),
      ).toHaveCount(0);
      await expect(
        memberPage.getByRole("button", { name: "観戦 URL をコピー" }),
      ).toHaveCount(0);
    } finally {
      await memberCtx.close();
    }
  });
});
