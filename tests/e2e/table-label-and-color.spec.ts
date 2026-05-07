import { test, expect } from "./fixtures/test-context";
import {
  consumeInviteUrl,
  createDefaultStructure,
  createGroup,
  issueInviteUrl,
  randomOrganizer,
  registerOrganizer,
  seedOrganizerTournament,
} from "./fixtures/flows";

/**
 * Phase C: テーブル呼称（label）/ 色（color）カスタム機能のユーザー観測点。
 *
 * 検証する振る舞い:
 *   1. organizer がサークル詳細画面で `defaultTableLabels` を登録 → 新規 tournament を
 *      作成 → 席決め commit → SeatingBoard 卓ヘッダに登録した label が index 順で
 *      表示される（auto-fill）
 *   2. organizer が dashboard 卓ヘッダの ✎ から label を更新 → 卓ヘッダ表示が
 *      新 label に切り替わる（label 未設定時は `Table N` フォールバック）
 *   3. 一般 member の dashboard には ✎ ボタンが表示されない（role gate）
 *   4. 一般 member のサークル詳細画面では `defaultTableLabels` カードに「編集」が
 *      出ない（read-only）
 *
 * 検証外:
 *   - color の hex 値そのもの（`<input type="color">` の visual 確認は手動 / unit）
 *   - rule 側の deny 検証（`scripts/test-rules-table-labels.mjs` で REST 直叩き済み）
 */

test.describe("Phase C: Table Label & Color", () => {
  // 冷えた emulator + organizer 登録 + commit seating まで通すため default 30s を拡張。
  test.describe.configure({ timeout: 90_000 });

  test("defaultTableLabels が新規 tournament の SeatingBoard に index 順で auto-fill される", async ({
    page,
    groupDetailPage,
    tournamentNewPage,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("tl-auto");
    await registerOrganizer(page, organizer);
    const gid = await createGroup(page, "TL Auto Group");
    await createDefaultStructure(page, "TL Auto Default");

    // サークル詳細画面で defaultTableLabels を 2 件登録。
    const detail = groupDetailPage(gid);
    await detail.goto();
    await detail.expectLoaded();
    await detail.setDefaultTableLabels(["赤卓", "青卓"]);
    await expect(detail.defaultTableLabelsCard).toContainText("赤卓");
    await expect(detail.defaultTableLabelsCard).toContainText("青卓");

    // 新規 tournament を seatsPerTable=2 で作成 → 1 名 self-join + 2 名ゲスト → 3 名で 2 卓構成
    // （`engine.planInitialSeating` は `Math.ceil(active / seatsPerTable)` で卓数決定。
    //  3 / 2 = 2 卓）。defaultTableLabels の index 順 auto-fill を 2 卓で観測する。
    //  注: schema は seatsPerTable.min(2) のため 1 卓構成（seatsPerTable=1）は使えない。
    const tid = await tournamentNewPage.create("TL Auto Tournament", 2);

    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({ timeout: 15_000 });

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    for (const guestName of ["TLGuest1", "TLGuest2"]) {
      const guestCtx = await browser.newContext();
      try {
        const guestPage = await guestCtx.newPage();
        await guestPage.goto(`/join/${tid}`);
        await guestPage.getByRole("tab", { name: "ゲスト" }).click();
        await guestPage.getByLabel("表示名").fill(guestName);
        await guestPage.getByRole("button", { name: /ゲストで受付/ }).click();
        await expect(
          guestPage.getByText(/受付完了|既に参加済み/),
        ).toBeVisible({ timeout: 30_000 });
        await guestPage.close();
      } finally {
        await guestCtx.close();
      }
    }
    await expect(page.getByText(/参加者 \(3\)/)).toBeVisible({ timeout: 15_000 });

    // 席決め commit → SeatingBoard が 2 卓表示される（auto-fill: 1=赤卓 / 2=青卓）。
    await dash.commitSeatingOnly();

    await expect(dash.tableHeaderTitle(1)).toContainText("赤卓", { timeout: 15_000 });
    await expect(dash.tableHeaderTitle(2)).toContainText("青卓");
  });

  test("organizer は dashboard 卓ヘッダの ✎ から label を更新できる", async ({
    page,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("tl-edit");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      groupName: "TL Edit Group",
      structureName: "TL Edit Default",
      tournamentName: "TL Edit Tournament",
      seatsPerTable: 2,
    });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({ timeout: 15_000 });
    await dash.commitSeatingOnly();

    // 初期は label 未設定 → `Table 1` 表示。
    await expect(dash.tableHeaderTitle(1)).toContainText("Table 1");

    // ✎ で label を「赤卓」に更新 → 卓ヘッダ表示が切り替わる。
    await dash.editTableLabel(1, "赤卓");
    await expect(dash.tableHeaderTitle(1)).toContainText("赤卓", { timeout: 10_000 });
    await expect(dash.tableHeaderTitle(1)).not.toContainText("Table 1");
  });

  test("一般 member は dashboard 卓ヘッダの ✎ ボタンが表示されない", async ({
    page,
    tournamentDashboardPage,
  }) => {
    // owner: tournament を作成し、commit seating まで進めて SeatingBoard を露出させる。
    const owner = randomOrganizer("tl-mb-ow");
    const { gid, tid } = await seedOrganizerTournament(page, {
      organizer: owner,
      groupName: "TL Member Gate Group",
      structureName: "TL Member Gate Default",
      tournamentName: "TL Member Gate Tournament",
      seatsPerTable: 2,
    });
    const ownerDash = tournamentDashboardPage(tid);
    await ownerDash.goto();
    await ownerDash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({ timeout: 15_000 });
    await ownerDash.commitSeatingOnly();
    const inviteUrl = await issueInviteUrl(page, gid);

    // member: 別 context で加入 → /tournaments/[tid] に直接アクセスして role gate を観測。
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("tl-mb");
      await registerOrganizer(memberPage, member);
      const joinedGid = await consumeInviteUrl(memberPage, inviteUrl);
      expect(joinedGid).toBe(gid);

      // dashboard-client は organizer 以外を /live にリダイレクトする実装のため、
      // /tournaments/[tid] への直アクセス後の URL を確認しつつ、最終的に
      // どの URL でも「edit-table-1」ボタンが居ないことを検証する。
      await memberPage.goto(`/tournaments/${tid}`);
      await expect(memberPage.locator("main")).toBeVisible({ timeout: 15_000 });

      await expect(
        memberPage.getByRole("button", { name: "edit-table-1" }),
      ).toHaveCount(0);
    } finally {
      await memberCtx.close();
    }
  });

  test("一般 member のサークル詳細では defaultTableLabels カードに編集ボタンが出ない", async ({
    page,
    groupDetailPage,
  }) => {
    // owner: group 作成 + defaultTableLabels に 1 件登録 + 招待コード発行。
    // tournament は本テストでは不要なので createGroup 単独で済ませる（同 email
    // を 2 度 signUp する事故を避ける）。
    const owner = randomOrganizer("tl-grp-ow");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "TL Group ReadOnly");

    const detail = groupDetailPage(gid);
    await detail.goto();
    await detail.expectLoaded();
    await detail.setDefaultTableLabels(["赤卓"]);
    const inviteUrl = await issueInviteUrl(page, gid);

    // member 側
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("tl-grp-mb");
      await registerOrganizer(memberPage, member);
      const joinedGid = await consumeInviteUrl(memberPage, inviteUrl);
      expect(joinedGid).toBe(gid);

      await memberPage.goto(`/groups/${gid}`);
      // カード自体は read-only で表示される（label "赤卓" は見える）が、編集ボタンは無い。
      await expect(memberPage.getByText("テーブル呼称デフォルト")).toBeVisible({
        timeout: 15_000,
      });
      await expect(memberPage.getByText("赤卓")).toBeVisible();

      // 「編集」ボタンが card scope 内に存在しないこと。
      const card = memberPage.locator('[aria-label="default-table-labels-card"]');
      await expect(card.getByRole("button", { name: /^編集$/ })).toHaveCount(0);
    } finally {
      await memberCtx.close();
    }
  });
});
