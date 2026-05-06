import { test, expect } from "./fixtures/test-context";
import { getDocument } from "./fixtures/emulator";
import { joinAsGuest, randomOrganizer, seedOrganizerTournament } from "./fixtures/flows";

/**
 * Phase 5.3: Append Blind Level（進行中のレベル末尾追加）の E2E。
 *
 * unit test（`tournament-state.test.ts` / `tournaments.test.ts` /
 * `AppendLevelDialog.test.tsx` / `StructureSnapshotCard.test.tsx`）で純関数 /
 * repository / dialog / card の各層は担保済み。E2E では「dashboard ↔ Firestore
 * の append ラウンドトリップ」と「`/live` 側の append button 不在（regression 0）」を
 * 観測可能な振る舞いとして固定する。
 *
 *   1. setup 状態の organizer が `+ レベル追加` ボタン → Dialog → 「追加」 で
 *      末尾に新規 Lv が追加され、Firestore の `structureSnapshot.levels.length` が
 *      `oldLength + 1` になる
 *   2. running 状態の organizer が「ブレイクとして追加」をチェックして append すると
 *      isBreak=true / sb=bb=ante=0 の Lv が末尾に push される
 *   3. `/live` ページの StructureSnapshotCard には `+ レベル追加` ボタンが描画されない
 *      （live-client が canAppend / onAppendLevel を渡さないため）
 */

interface FieldsRecord {
  fields?: Record<string, unknown>;
}

interface LevelView {
  level: number;
  sb: number;
  bb: number;
  ante: number;
  durationSec: number;
  isBreak: boolean;
}

/**
 * Firestore Emulator REST レスポンスから
 * `tournaments/{tid}.structureSnapshot.levels` を配列として取り出し、
 * UI 視点の数値型に正規化する。
 */
function readLevels(doc: Record<string, unknown>): LevelView[] | null {
  const fields = (doc as FieldsRecord).fields ?? {};
  const snap = fields.structureSnapshot as { mapValue?: FieldsRecord } | undefined;
  const snapFields = snap?.mapValue?.fields ?? {};
  const levels = snapFields.levels as
    | { arrayValue?: { values?: Array<{ mapValue?: FieldsRecord }> } }
    | undefined;
  const values = levels?.arrayValue?.values;
  if (!values) return null;
  return values.map((entry) => {
    const f = entry.mapValue?.fields ?? {};
    const intOf = (key: string): number =>
      Number((f[key] as { integerValue?: string } | undefined)?.integerValue ?? 0);
    const boolOf = (key: string): boolean =>
      Boolean((f[key] as { booleanValue?: boolean } | undefined)?.booleanValue);
    return {
      level: intOf("level"),
      sb: intOf("sb"),
      bb: intOf("bb"),
      ante: intOf("ante"),
      durationSec: intOf("durationSec"),
      isBreak: boolOf("isBreak"),
    };
  });
}

test.describe("Phase 5.3: append blind level", () => {
  test("setup 状態で organizer が末尾レベルを追加すると Firestore の levels が +1 される", async ({
    page,
    request,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("apl-su");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Append Setup",
    });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await expect(dash.stateBadge).toHaveText("開始前", { timeout: 15_000 });

    // default structure（structures/new の初期 2 レベル: Lv1=600s / Lv2=600s）。
    // append 前に levels.length=2 を Firestore で確認しておく（baseline）。
    const before = await getDocument(request, `tournaments/${tid}`);
    const baseline = readLevels(before.data!);
    expect(baseline).not.toBeNull();
    expect(baseline!.length).toBe(2);

    // 「+ レベル追加」 button → Dialog open。
    const appendBtn = page.getByRole("button", { name: "レベル追加" });
    await expect(appendBtn).toBeVisible();
    await appendBtn.click();

    // Dialog タイトルは「レベル 3 を末尾に追加」。
    await expect(page.getByText("レベル 3 を末尾に追加")).toBeVisible({
      timeout: 10_000,
    });

    // defaults のまま「追加」（Lv2 が sb=50/bb=100/durationSec=600 → defaults: 100/200/0/10min）。
    // `+ レベル追加` トリガと衝突しないよう完全一致でフィルタ。
    await page.getByRole("button", { name: /^追加$/ }).click();

    // Firestore で levels.length=3 になる。
    await expect
      .poll(
        async () => {
          const snap = await getDocument(request, `tournaments/${tid}`);
          if (!snap.exists) return null;
          const levels = readLevels(snap.data!);
          return levels?.length ?? null;
        },
        { timeout: 10_000 },
      )
      .toBe(3);

    // 新 Lv 3 の中身: defaults 派生（last play level Lv2: sb=50, bb=100, ante=0, dur=600 →
    // sb=100, bb=200, ante=0, durationSec=600）。
    const after = await getDocument(request, `tournaments/${tid}`);
    const levels = readLevels(after.data!);
    expect(levels).not.toBeNull();
    expect(levels![2]).toEqual({
      level: 3,
      sb: 100,
      bb: 200,
      ante: 0,
      durationSec: 600,
      isBreak: false,
    });

    // append 後、Phase 5.2 の `Lv 3 の時間を変更` Pencil ボタンも UI に出現する
    // （新 Lv にも EditableLevelDurationCell が同時に効く lock）。
    await expect(
      page.getByRole("button", { name: "Lv 3 の時間を変更" }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("running 状態でブレイクとして append すると isBreak=true / sb=bb=ante=0 の Lv が末尾追加される", async ({
    page,
    tournamentDashboardPage,
    request,
  }) => {
    // 2 名以上必要（1 名のみだと winner 自動 finish が走り running を維持できない可能性）。
    const organizer = randomOrganizer("apl-rn");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Append Running Break",
    });

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const guestCtx = await browser.newContext();
    try {
      const guestPage = await guestCtx.newPage();
      await joinAsGuest(guestPage, tid, "AplGuest");
      await guestPage.close();
    } finally {
      await guestCtx.close();
    }

    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(2\)/)).toBeVisible({ timeout: 15_000 });

    await dash.startTournament();
    await expect(dash.stateBadge).toHaveText("進行中");

    // Append button → Dialog → ブレイクチェック → 「追加」。
    await page.getByRole("button", { name: "レベル追加" }).click();
    await expect(page.getByText("レベル 3 を末尾に追加")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByLabel("ブレイクとして追加").check();
    await page.getByRole("button", { name: /^追加$/ }).click();

    // Firestore に sb=bb=ante=0 / isBreak=true の Lv 3 が追加される。
    await expect
      .poll(
        async () => {
          const snap = await getDocument(request, `tournaments/${tid}`);
          if (!snap.exists) return null;
          const levels = readLevels(snap.data!);
          if (!levels || levels.length < 3) return null;
          return levels[2];
        },
        { timeout: 10_000 },
      )
      .toEqual({
        level: 3,
        sb: 0,
        bb: 0,
        ante: 0,
        durationSec: 600,
        isBreak: true,
      });
  });

  test("/live ページでは + レベル追加 button が描画されない（regression 0）", async ({
    page,
    livePage,
  }) => {
    // /live は live-client が canAppend / onAppendLevel を渡さないため append 不可。
    const organizer = randomOrganizer("apl-lv");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Append Live Readonly",
    });

    const live = livePage(tid);
    await live.goto();

    await expect(page.getByText("ストラクチャ snapshot")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: "レベル追加" }),
    ).toHaveCount(0);
  });
});
