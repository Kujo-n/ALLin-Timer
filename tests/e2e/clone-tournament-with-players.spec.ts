import { test, expect } from "./fixtures/test-context";
import { getDocument } from "./fixtures/emulator";
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
 * Phase 5.4: Clone Tournament With Players の E2E。
 *
 * unit test（`tournament-state.test.ts` / `players.test.ts` /
 * `tournament-clone.test.ts` / `ClonePlayersChecklist.test.tsx`）で純関数 /
 * repository / orchestrator / Checklist の各層は担保済み。E2E では「終了済み
 * dashboard ↔ /tournaments/[tid]/clone ↔ Firestore の clone ラウンドトリップ」と
 * 「一般メンバーには clone 動線が見えない（regression 0）」を観測可能な振る舞いとして固定する。
 *
 *   1. organizer が finished tournament の dashboard で「同じ参加者で次のトーナメントを作成」
 *      ボタン → /tournaments/[tid]/clone へ遷移 → 「作成」 → 新 tournament の players に
 *      選択分の player doc が writeBatch で複製されることを Firestore で観測
 *   2. 一般メンバーは finished dashboard でも clone リンクが見えず、`/tournaments/[tid]/clone`
 *      直リンクは `/tournaments/[tid]` へ redirect される（live 経由ではなく dashboard 直行）
 */

interface FieldsRecord {
  fields?: Record<string, unknown>;
}

/** Firestore Emulator REST レスポンスから `players` 配列の id 集合を取り出す（admin REST 経由）。 */
async function listPlayerIds(
  request: import("@playwright/test").APIRequestContext,
  tid: string,
): Promise<string[]> {
  const E2E_PROJECT_ID = "allin-pokertimer-e2e";
  const FIRESTORE_EMULATOR = "http://127.0.0.1:8080";
  const res = await request.get(
    `${FIRESTORE_EMULATOR}/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents/tournaments/${tid}/players`,
    { headers: { Authorization: "Bearer owner" } },
  );
  if (!res.ok()) {
    throw new Error(`listPlayerIds failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    documents?: Array<{ name: string }>;
  };
  return (body.documents ?? []).map((d) => {
    const m = d.name.match(/\/players\/([^/]+)$/);
    return m ? m[1] : d.name;
  });
}

function readPlayerFields(doc: Record<string, unknown>): {
  uid: string | null;
  isBusted: boolean;
  tableNum: number | null;
  seatNum: number | null;
  isPlayingDealer: boolean;
} {
  const f = (doc as FieldsRecord).fields ?? {};
  const uid =
    (f.uid as { stringValue?: string; nullValue?: null } | undefined)?.stringValue ?? null;
  const isBusted = Boolean(
    (f.isBusted as { booleanValue?: boolean } | undefined)?.booleanValue,
  );
  const tableRaw = f.tableNum as
    | { integerValue?: string; nullValue?: null }
    | undefined;
  const seatRaw = f.seatNum as
    | { integerValue?: string; nullValue?: null }
    | undefined;
  const isPlayingDealer = Boolean(
    (f.isPlayingDealer as { booleanValue?: boolean } | undefined)?.booleanValue,
  );
  return {
    uid,
    isBusted,
    tableNum: tableRaw?.integerValue ? Number(tableRaw.integerValue) : null,
    seatNum: seatRaw?.integerValue ? Number(seatRaw.integerValue) : null,
    isPlayingDealer,
  };
}

test.describe("Phase 5.4: clone tournament with players", () => {
  test("organizer が finished tournament を clone すると新 tournament に選択 players が writeBatch で複製される", async ({
    page,
    request,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("clone-or");
    const { tid: srcTid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Clone Source",
    });

    // ---------- 参加者 2 名を別 context からゲスト受付 ----------
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const aliceCtx = await browser.newContext();
    const bobCtx = await browser.newContext();
    try {
      const alicePage = await aliceCtx.newPage();
      await joinAsGuest(alicePage, srcTid, "Alice");
      await alicePage.close();

      const bobPage = await bobCtx.newPage();
      await joinAsGuest(bobPage, srcTid, "Bob");
      await bobPage.close();
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }

    const dash = tournamentDashboardPage(srcTid);
    await dash.goto();
    await expect(page.getByText(/参加者 \(2\)/)).toBeVisible({ timeout: 15_000 });

    // ---------- setup → seating → running → 1 名 bust → finished ----------
    await dash.startTournament();
    await expect(dash.stateBadge).toHaveText("進行中");
    await dash.bustPlayer("Alice");
    // Alice bust → 残り 1 名で auto-finish が 2s delay 後に走る。
    await expect(dash.stateBadge).toHaveText("終了", { timeout: 15_000 });
    await expect(dash.winnerBanner).toBeVisible();

    // ---------- src tournament の player ID を控える（clone 元）----------
    const srcPlayerIds = await listPlayerIds(request, srcTid);
    expect(srcPlayerIds.length).toBe(2);

    // ---------- 「同じ参加者で次のトーナメントを作成」ボタン → /clone へ遷移 ----------
    const cloneBtn = page.getByRole("link", {
      name: "同じ参加者で次のトーナメントを作成",
    });
    await expect(cloneBtn).toBeVisible({ timeout: 10_000 });
    await Promise.all([
      page.waitForURL(`**/tournaments/${srcTid}/clone`, { timeout: 15_000 }),
      cloneBtn.click(),
    ]);

    // ---------- clone ページの初期状態 ----------
    await expect(
      page.getByRole("heading", { name: "同じ参加者で次のトーナメントを作成" }),
    ).toBeVisible();

    // busted (Alice) は default OFF / non-busted (Bob) は default ON。
    // selector は data-testid（visible <label> の accessible name を上書きしない a11y 配慮）。
    const aliceBox = page.getByTestId("clone-checkbox-Alice");
    const bobBox = page.getByTestId("clone-checkbox-Bob");
    await expect(aliceBox).not.toBeChecked();
    await expect(bobBox).toBeChecked();

    // 件数 badge は「1 / 2 名選択」。busted を 1 件含む。
    await expect(page.getByText(/参加者（1 \/ 2 名選択）/)).toBeVisible();

    // ---------- Alice もチェックして両者複製 ----------
    await aliceBox.check();
    await expect(page.getByText(/参加者（2 \/ 2 名選択）/)).toBeVisible();

    // ---------- 「作成」 → 新 tournament dashboard へ遷移 ----------
    const submitBtn = page.getByRole("button", { name: /^作成$/ });
    await Promise.all([
      page.waitForURL(
        (url) => {
          const m = url.pathname.match(/^\/tournaments\/([^/]+)$/);
          return m !== null && m[1] !== srcTid && m[1] !== "new";
        },
        { timeout: 30_000 },
      ),
      submitBtn.click(),
    ]);

    const newTidMatch = page.url().match(/\/tournaments\/([^/?#]+)/);
    if (!newTidMatch) throw new Error(`failed to parse newTid from ${page.url()}`);
    const newTid = newTidMatch[1];
    expect(newTid).not.toBe(srcTid);

    // ---------- 新 tournament の dashboard が setup 状態で着地し、players が 2 名で表示される ----------
    const newDash = tournamentDashboardPage(newTid);
    await expect(newDash.stateBadge).toHaveText("開始前", { timeout: 15_000 });
    await expect(page.getByText(/参加者 \(2\)/)).toBeVisible({ timeout: 15_000 });

    // ---------- Firestore で新 tournament の players を直接観測 ----------
    const newPlayerIds = await listPlayerIds(request, newTid);
    expect(newPlayerIds.sort()).toEqual([...srcPlayerIds].sort());

    // 各 player doc が clone 規約通りに reset されている。
    for (const pid of newPlayerIds) {
      const snap = await getDocument(request, `tournaments/${newTid}/players/${pid}`);
      expect(snap.exists).toBe(true);
      const view = readPlayerFields(snap.data!);
      expect(view.uid).toBe(pid);
      expect(view.isBusted).toBe(false);
      expect(view.tableNum).toBeNull();
      expect(view.seatNum).toBeNull();
      expect(view.isPlayingDealer).toBe(false);
    }
  });

  test("一般メンバーは finished dashboard で clone リンクが見えず、/clone 直リンクは redirect される", async ({
    page,
    tournamentDashboardPage,
  }) => {
    // ---------- owner 側 (context A) ----------
    const owner = randomOrganizer("clone-ow");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Clone Role Group");
    await createDefaultStructure(page, "Clone Role Default");
    const tid = await createTournament(page, "Clone Role Tournament");
    const inviteUrl = await issueInviteUrl(page, gid);

    // ---------- ゲスト 1 名受付（auto-finish の active=1 を成立させる）----------
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const guestCtx = await browser.newContext();
    try {
      const gp = await guestCtx.newPage();
      await joinAsGuest(gp, tid, "Carol");
      await gp.close();
    } finally {
      await guestCtx.close();
    }

    // ---------- owner が自分も参加 → start → bust → finished ----------
    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await dash.selfJoinButton.click();
    await expect(page.getByText(/参加者 \(2\)/)).toBeVisible({ timeout: 15_000 });
    await dash.startTournament();
    await dash.bustPlayer("Carol");
    await expect(dash.stateBadge).toHaveText("終了", { timeout: 15_000 });

    // ---------- 一般メンバー側 (context B) ----------
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("clone-mb");
      await registerOrganizer(memberPage, member);
      await consumeInviteUrl(memberPage, inviteUrl);

      // (1) 一般メンバーが /tournaments/[tid] を直接踏むと /live へ redirect される
      //     （Phase 4.6 既存挙動）。clone リンクが「dashboard」にしか出ないため
      //     一般メンバーは構造的に踏めない。
      await memberPage.goto(`/tournaments/${tid}`);
      await memberPage.waitForURL(`**/tournaments/${tid}/live`, {
        timeout: 15_000,
      });
      await expect(
        memberPage.getByRole("link", {
          name: "同じ参加者で次のトーナメントを作成",
        }),
      ).toHaveCount(0);

      // (2) /clone 直リンクは clone-client 側の useEffect で
      //     `/tournaments/{tid}` に redirect → さらに dashboard guard で /live に redirect。
      //     最終的に /live に着地することを確認する。
      await memberPage.goto(`/tournaments/${tid}/clone`);
      await memberPage.waitForURL(`**/tournaments/${tid}/live`, {
        timeout: 15_000,
      });
    } finally {
      await memberCtx.close();
    }
  });
});
