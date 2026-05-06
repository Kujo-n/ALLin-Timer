import { test, expect } from "./fixtures/test-context";
import { getDocument } from "./fixtures/emulator";
import { joinAsGuest, randomOrganizer, seedOrganizerTournament } from "./fixtures/flows";

/**
 * Phase 5.2: Dynamic Blind Adjustment（レベル時間の進行中変更）の E2E。
 *
 * unit test（`tournament-state.test.ts` / `tournaments.test.ts` /
 * `EditableLevelDurationCell.test.tsx` / `timer.test.ts`）で純関数 / repository /
 * cell view / `getRemainingMs` の数式追従は担保済み。E2E では「dashboard ↔ Firestore
 * の inline edit ラウンドトリップ」と「`/live` 側の read-only 維持（regression 0）」を
 * 観測可能な振る舞いとして固定する。
 *
 *   1. setup 状態の organizer が `Lv 1 の時間を変更` を経由して
 *      `structureSnapshot.levels[0].durationSec` を書き換えると Firestore に反映
 *   2. running 状態の organizer が未来レベル（Lv 2）を inline edit した結果が Firestore
 *      に反映される（過去レベル disable / 現在以降のみ編集可の `canEditLevelDurations`
 *      仕様の最小代表ケース）
 *   3. `/live` ページの StructureSnapshotCard には `Pencil` ボタン（編集 affordance）
 *      が一切描画されない（live-client が canEdit / onUpdateDurationSec を渡さないため
 *      `editingEnabled === false` になることの UI 観測）
 */

interface FieldsRecord {
  fields?: Record<string, unknown>;
}

/**
 * Firestore Emulator REST レスポンスから
 * `tournaments/{tid}.structureSnapshot.levels[levelIndex].durationSec` を取り出す。
 *
 * Firestore REST は型ラップ（`mapValue.fields` / `arrayValue.values` / `integerValue`）
 * を経由するため、各層を辿って最終的に `Number()` で数値化する。
 */
function readLevelDurationSec(
  doc: Record<string, unknown>,
  levelIndex: number,
): number | null {
  const fields = (doc as FieldsRecord).fields ?? {};
  const snap = fields.structureSnapshot as { mapValue?: FieldsRecord } | undefined;
  const snapFields = snap?.mapValue?.fields ?? {};
  const levels = snapFields.levels as
    | { arrayValue?: { values?: Array<{ mapValue?: FieldsRecord }> } }
    | undefined;
  const values = levels?.arrayValue?.values ?? [];
  const target = values[levelIndex];
  if (!target?.mapValue?.fields) return null;
  const dur = target.mapValue.fields.durationSec as
    | { integerValue?: string }
    | undefined;
  if (!dur?.integerValue) return null;
  return Number(dur.integerValue);
}

test.describe("Phase 5.2: dynamic blind adjustment", () => {
  test("setup 状態で organizer が Lv 1 の durationSec を inline edit すると Firestore に反映される", async ({
    page,
    request,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("dba-su");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Dynamic Blind Setup",
    });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await expect(dash.stateBadge).toHaveText("開始前", { timeout: 15_000 });

    // default structure（structures/new の初期 2 レベル）は 600 秒（10 分）。
    // Pencil ボタンの accessible name は EditableLevelDurationCell の
    // `aria-label={`Lv ${levelIndex + 1} の時間を変更`}` で確定している。
    const editLv1 = page.getByRole("button", { name: "Lv 1 の時間を変更" });
    await expect(editLv1).toBeVisible();
    await editLv1.click();

    // 編集 mode に入ると <Input aria-label="Lv 1 の時間（分）"> が現れる。
    const input = page.getByLabel("Lv 1 の時間（分）");
    await expect(input).toBeVisible();
    await input.fill("15");

    // 保存ボタンの accessible name は完全一致 `^保存$`。Dialog 内の他の保存ボタンは
    // setup 画面では存在しないが、Phase 4.x で追加される可能性に備えて role+name で絞る。
    await page.getByRole("button", { name: /^保存$/ }).click();

    // 編集 mode が閉じ、Pencil ボタンの新表示値（15）に切り替わる。
    await expect(editLv1).toBeVisible({ timeout: 10_000 });
    await expect(editLv1).toContainText("15");

    // Firestore 上で structureSnapshot.levels[0].durationSec が 900 になる。
    await expect
      .poll(
        async () => {
          const snap = await getDocument(request, `tournaments/${tid}`);
          if (!snap.exists) return null;
          return readLevelDurationSec(snap.data!, 0);
        },
        { timeout: 10_000 },
      )
      .toBe(900);
  });

  test("running 状態で organizer が未来レベル（Lv 2）を inline edit すると Firestore に反映される", async ({
    page,
    request,
    tournamentDashboardPage,
  }) => {
    // 2 名以上必要（1 名のみだと winner 自動 finish が走り running を維持できない可能性）。
    // ゲスト 1 名 + 運営者自己参加で active=2 にし、auto-finish を回避する。
    const organizer = randomOrganizer("dba-rn");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Dynamic Blind Running",
    });

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const guestCtx = await browser.newContext();
    try {
      const guestPage = await guestCtx.newPage();
      await joinAsGuest(guestPage, tid, "DbaGuest");
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

    // running 状態（currentLevel=1）では Lv 1 / Lv 2 ともに編集可（`canEditLevelDurations`
    // の `levelIndex >= currentLevel - 1` 仕様）。ここでは未来レベル（Lv 2）を編集して
    // 進行中タイマーと無関係に Firestore に書き込まれることを観測する（Lv 1 編集は
    // タイマー表示と timing 競合の余地があるため、回帰検証は未来レベルで安定確保する）。
    const editLv2 = page.getByRole("button", { name: "Lv 2 の時間を変更" });
    await expect(editLv2).toBeVisible();
    await editLv2.click();

    const input = page.getByLabel("Lv 2 の時間（分）");
    await expect(input).toBeVisible();
    await input.fill("7");
    await page.getByRole("button", { name: /^保存$/ }).click();

    // 編集 mode が閉じ、新値（7）が cell に反映される。
    await expect(editLv2).toBeVisible({ timeout: 10_000 });
    await expect(editLv2).toContainText("7");

    // Firestore 上で structureSnapshot.levels[1].durationSec が 420 になる。
    // 同時に levels[0]（Lv 1）は 600 のまま変更されないことも確認し、
    // 「指定 levelIndex 以外は preserve される」repository 契約の最小代表として固定。
    await expect
      .poll(
        async () => {
          const snap = await getDocument(request, `tournaments/${tid}`);
          if (!snap.exists) return null;
          return {
            lv1: readLevelDurationSec(snap.data!, 0),
            lv2: readLevelDurationSec(snap.data!, 1),
          };
        },
        { timeout: 10_000 },
      )
      .toEqual({ lv1: 600, lv2: 420 });
  });

  test("/live ページでは StructureSnapshotCard が read-only で Pencil ボタンが描画されない", async ({
    page,
    livePage,
  }) => {
    // /live は live-client.tsx が `canEdit` / `onUpdateDurationSec` を渡さないため、
    // `StructureSnapshotCard` の `editingEnabled === false` で `EditableLevelDurationCell`
    // 経由ではなく素の数値が描画される（regression 0 の可視化）。
    //
    // 認証は organizer のままで /live を踏んでも、prop 不在で affordance が出ない
    // ことが本テストの主眼。member 視点ではなくコンポーネント側の prop 漏れの検出を狙う。
    const organizer = randomOrganizer("dba-lv");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Dynamic Blind Live Readonly",
    });

    const live = livePage(tid);
    await live.goto();

    // ストラクチャ snapshot 自体は描画されている（カード見出しの存在で軽く確認）。
    await expect(page.getByText("ストラクチャ snapshot")).toBeVisible({
      timeout: 15_000,
    });

    // Pencil ボタン群が一切描画されない（default structure は 2 レベルなので
    // Lv 1 / Lv 2 の両方を確認すれば十分）。
    await expect(
      page.getByRole("button", { name: "Lv 1 の時間を変更" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Lv 2 の時間を変更" }),
    ).toHaveCount(0);
  });
});
