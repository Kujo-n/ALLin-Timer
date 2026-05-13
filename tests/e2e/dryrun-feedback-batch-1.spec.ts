import { test, expect } from "./fixtures/test-context";
import {
  consumeInviteUrl,
  createDefaultStructure,
  createGroup,
  createTournament,
  issueInviteUrl,
  joinAsGuest,
  randomOrganizer,
  registerOrganizer,
  seedOrganizerTournament,
} from "./fixtures/flows";

/**
 * 05-post-launch-polish / Phase C.1（dryrun-feedback-batch-1）の user-observable な
 * 振る舞いを 1 spec で集約検証する。各 test は plan の Manual Validation チェックを
 * 自動化したもの。
 *
 *   - 改善 1: `/tournaments/new` の name デフォルトが `Tournament-No.X`
 *   - 改善 2: `/tournaments` 一覧で member が参加済み tournament を「参加済み」ボタンで識別
 *   - 改善 3a: 招待コードを再発行 → 旧 URL が「無効な招待コード」で deny
 *   - 改善 4: 観戦 ON 状態の tournament を終了 → SpectateModeCard が OFF + anon が
 *     `/spectate/[tid]` を開けない
 *
 * 起動コスト最適化のため、可能な限り 1 test で複数の検証を連鎖させる。
 * `fullyParallel: false` / `workers: 1` なので emulator state は test 間で reset 済み。
 */

const SPECTATE_TOGGLE = "観戦モードを切り替え";
const SPECTATE_CONFIRM_ON = "ON にする";

test.describe("dryrun-feedback-batch-1 polish bundle", () => {
  test("改善 1: 新規トーナメント作成画面の name デフォルトが `Tournament-No.X` プリフィル", async ({
    page,
  }) => {
    // setup: organizer + group + structure。tournament はこの test 内では作らないので
    //   seedOrganizerTournament ではなく個別 helper を組み合わせる。
    const organizer = randomOrganizer("op-default-name");
    await registerOrganizer(page, organizer);
    await createGroup(page, "Default Name Group");
    await createDefaultStructure(page, "Default Name Struct");

    // 1 回目の作成画面: finishedTournamentCount=0 なので Tournament-No.1
    await page.goto("/tournaments/new");
    await expect(page.getByLabel("トーナメント名")).toHaveValue("Tournament-No.1");

    // 旧 `[サークル名]トーナメント-X` プリフィルが残っていないことの negative 検証
    await expect(page.getByLabel("トーナメント名")).not.toHaveValue(/トーナメント-/);
    await expect(page.getByLabel("トーナメント名")).not.toHaveValue(/Default Name Group/);
  });

  test("改善 2: 一覧で member 視点の participate 状態がボタンに反映される（organizer 視点は タイマー）", async ({
    page,
  }) => {
    // setup: owner で group + 2 つの tournament を作成（1 つは member が参加 / 1 つは未参加）
    const owner = randomOrganizer("op-joined");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Joined Group");
    await createDefaultStructure(page, "Joined Default");
    const joinedTid = await createTournament(page, "Joined Tournament");
    const unjoinedTid = await createTournament(page, "Unjoined Tournament");
    const inviteUrl = await issueInviteUrl(page, gid);

    // organizer 視点では一覧の両方の row に「タイマー」ボタンが出る（参加判定は発火しない）
    //   `hasText: "Joined Tournament"` だと "Unjoined Tournament" にもマッチするため、
    //   aria-label のフル一致（"<name>（<state ラベル>）"）でカードを一意に絞り込む。
    await page.goto("/tournaments");
    const ownerJoinedCard = page.getByRole("group", {
      name: "Joined Tournament（未開催）",
      exact: true,
    });
    const ownerUnjoinedCard = page.getByRole("group", {
      name: "Unjoined Tournament（未開催）",
      exact: true,
    });
    await expect(
      ownerJoinedCard.getByRole("button", { name: /^タイマー$/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      ownerUnjoinedCard.getByRole("button", { name: /^タイマー$/ }),
    ).toBeVisible();

    // ── member 側 (context B) ──
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("mem-joined");
      await registerOrganizer(memberPage, member);
      const joinedGid = await consumeInviteUrl(memberPage, inviteUrl);
      expect(joinedGid).toBe(gid);

      // member が片方の tournament だけ /live で 1-tap join する
      await memberPage.goto(`/tournaments/${joinedTid}/live`);
      const joinButton = memberPage.getByRole("button", { name: /^参加する$/ });
      await expect(joinButton).toBeVisible({ timeout: 15_000 });
      await joinButton.click();
      await expect(joinButton).toHaveCount(0, { timeout: 15_000 });

      // /tournaments 一覧へ戻る。参加済みは「参加済み」/ 未参加は「参加する」になっていることを検証
      await memberPage.goto("/tournaments");
      const joinedCard = memberPage.getByRole("group", {
        name: "Joined Tournament（未開催）",
        exact: true,
      });
      const unjoinedCard = memberPage.getByRole("group", {
        name: "Unjoined Tournament（未開催）",
        exact: true,
      });
      await expect(joinedCard).toBeVisible({ timeout: 15_000 });
      await expect(unjoinedCard).toBeVisible();

      // 参加済み: 「参加済み」 button が出て「参加する」は消える
      await expect(
        joinedCard.getByRole("button", { name: /参加済み/ }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        joinedCard.getByRole("button", { name: /^参加する$/ }),
      ).toHaveCount(0);

      // 未参加: 「参加する」のまま
      await expect(
        unjoinedCard.getByRole("button", { name: /^参加する$/ }),
      ).toBeVisible();
      await expect(unjoinedCard.getByText("参加済み")).toHaveCount(0);

      // organizer 専用「タイマー」label は member には出ない
      await expect(
        memberPage.getByRole("button", { name: /^タイマー$/ }),
      ).toHaveCount(0);
    } finally {
      await memberCtx.close();
    }
    void unjoinedTid; // setup の object 解放抑止
  });

  test("改善 3a: 招待コードを再発行 → 旧 URL を踏むと「無効な招待コード」 alert が出る", async ({
    page,
  }) => {
    // setup: owner + group
    const owner = randomOrganizer("op-reissue");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Reissue Group");

    // 1 回目発行 → URL を保存
    const firstUrl = await issueInviteUrl(page, gid);
    // 同 page に再発行ボタンが既にある（issueInviteUrl 完了後は URL 表示状態）。
    //   `<input readonly>` の value が新コードに置き換わったら再発行成功とみなす。
    const inviteInput = page.locator('input[readonly]').first();
    const firstValue = await inviteInput.inputValue();
    expect(firstValue).toBe(firstUrl);

    // 2 回目発行: same screen で「招待コードを発行」ボタンを再クリック
    //   ボタンの accessible name が「再発行」になる実装の可能性を考慮して両 pattern を許容する。
    const reissueButton = page.getByRole("button", {
      name: /^招待コードを発行$|^招待コードを再発行$/,
    });
    await reissueButton.click();
    // 旧と異なる新 URL に切り替わるまで待つ
    await expect
      .poll(async () => inviteInput.inputValue(), { timeout: 15_000 })
      .not.toBe(firstValue);
    const secondValue = await inviteInput.inputValue();
    expect(secondValue).not.toBe(firstValue);
    expect(secondValue).toContain("/groups/join/");

    // ── member 側 (context B) で**旧 URL を踏む** → エラー alert ──
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("mem-reissue");
      await registerOrganizer(memberPage, member);

      // 旧コードの URL を直接踏む
      const oldUrl = new URL(firstUrl);
      await memberPage.goto(oldUrl.pathname);

      // join-group-client は AppError の code + message を role="alert" で出す。
      //   `group/invalid-code: 無効な招待コードです` を含む alert が見える。
      //   Next.js の route announcer (`#__next-route-announcer__`) も role="alert" を持つため
      //   text content でフィルタする（announcer は空文字 / 一時的）。
      const alert = memberPage
        .getByRole("alert")
        .filter({ hasText: "招待コード" });
      await expect(alert).toBeVisible({ timeout: 15_000 });
      await expect(alert).toContainText("無効な招待コード");

      // member は member ロールに加入していない（groupIds が増えていない）はず。
      //   /groups に飛んで joined group のカードが存在しないことで verify する。
      await memberPage.goto("/groups");
      await expect(memberPage.getByText("Reissue Group")).toHaveCount(0);
    } finally {
      await memberCtx.close();
    }
  });

  test("改善 4: 観戦 ON のトーナメントを終了 → toggle が OFF に同期 + anon が /spectate を開けなくなる", async ({
    page,
    tournamentDashboardPage,
  }) => {
    // setup: organizer + group + tournament + 1 参加者（ゲスト）
    const organizer = randomOrganizer("op-finish-spec");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      groupName: "Finish Spectate Group",
      structureName: "Finish Spectate Default",
      tournamentName: "Finish Spectate Tournament",
    });

    // ゲスト 2 名で受付完了させる（active===1 の auto-finish と manual finish の race を回避）
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const guestACtx = await browser.newContext();
    const guestBCtx = await browser.newContext();
    try {
      const guestAPage = await guestACtx.newPage();
      await joinAsGuest(guestAPage, tid, "Alice");
      const guestBPage = await guestBCtx.newPage();
      await joinAsGuest(guestBPage, tid, "Bob");
    } finally {
      await guestACtx.close();
      await guestBCtx.close();
    }

    // organizer dashboard を開いて観戦モード ON にする
    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await expect(page.getByText(/参加者 \(2\)/)).toBeVisible({ timeout: 15_000 });

    const toggleSwitch = page.getByRole("switch", { name: SPECTATE_TOGGLE });
    await expect(toggleSwitch).toBeVisible({ timeout: 15_000 });
    await toggleSwitch.click();
    const confirmDialog = page.getByRole("dialog", {
      name: "観戦モードを ON にしますか？",
    });
    await expect(confirmDialog).toBeVisible({ timeout: 10_000 });
    await confirmDialog.getByRole("button", { name: SPECTATE_CONFIRM_ON }).click();
    await expect(toggleSwitch).toBeChecked({ timeout: 10_000 });

    // anon ctx で /spectate/[tid] が開けることを確認（baseline）
    const anonCtx = await browser.newContext();
    try {
      const anonPage = await anonCtx.newPage();
      await anonPage.goto(`/spectate/${tid}`);
      await expect(
        anonPage.getByRole("region", { name: "タイマー" }),
      ).toBeVisible({ timeout: 30_000 });

      // ── 席決め → 開始 → 終了 ──
      // running 状態でないと finishButton は visible でない。
      await dash.startTournament();
      await expect(dash.stateBadge).toHaveText("進行中");

      // 終了 → 確認 dialog → 終了する
      await dash.clickFinishAndConfirm();
      await expect(dash.stateBadge).toHaveText("終了", { timeout: 15_000 });

      // dashboard の SpectateModeCard toggle が finishTournament tx 経由で OFF に同期される
      await expect(toggleSwitch).not.toBeChecked({ timeout: 15_000 });

      // anon page は onSnapshot の permission-denied で graceful 遷移
      // （spectate-client の guard ladder で「観戦が終了しました」に着地）
      await expect(
        anonPage.getByRole("heading", { name: "観戦が終了しました" }),
      ).toBeVisible({ timeout: 30_000 });

      // 別の anon ctx で /spectate/[tid] を新規に開いても anon access deny
      const anon2Ctx = await browser.newContext();
      try {
        const anon2Page = await anon2Ctx.newPage();
        await anon2Page.goto(`/spectate/${tid}`);
        const ended = anon2Page.getByRole("heading", {
          name: "観戦が終了しました",
        });
        const notPublished = anon2Page.getByRole("heading", {
          name: "観戦が公開されていません",
        });
        await expect(ended.or(notPublished)).toBeVisible({ timeout: 30_000 });
      } finally {
        await anon2Ctx.close();
      }
    } finally {
      await anonCtx.close();
    }
  });
});
