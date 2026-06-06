import { test, expect } from "./fixtures/test-context";
import { getDocument } from "./fixtures/emulator";
import {
  consumeInviteUrl,
  issueInviteUrl,
  randomOrganizer,
  registerOrganizer,
  seedOrganizerTournament,
} from "./fixtures/flows";

/**
 * Phase 1〜2 (07-third-dryrun-improvements): 受付代理（proxy receipt）の E2E。
 *
 * unit / component test（`proxy-receipt.test.ts` / `entry-guards.test.ts` /
 * `players.test.ts` / `AddParticipantDialog.test.tsx` / `PlayerList.test.tsx`）で
 * service / repository / ダイアログ / リストの各層は担保済み。E2E では
 * 「dashboard の『参加者を追加』↔ AddParticipantDialog ↔ Firestore」の
 * ラウンドトリップを観測可能な振る舞いとして固定する:
 *
 *   1. organizer が名前のみ（ゲスト）参加者を代理受付 → 参加者一覧に「管理専用」
 *      バッジ付きで現れる → 表示名を編集すると反映される。Firestore で uid=null を観測
 *   2. organizer が招待コードで加入したメンバーを member タブから代理受付 →
 *      参加者一覧に現れる。Firestore で uid=memberUid を観測（pid==uid）
 */

const E2E_PROJECT_ID = "allin-pokertimer-e2e";
const FIRESTORE_EMULATOR = "http://127.0.0.1:8080";

/** tournaments/{tid}/players 配下の {id, uid} 一覧を admin REST 経由で取得。 */
async function listPlayers(
  request: import("@playwright/test").APIRequestContext,
  tid: string,
): Promise<Array<{ id: string; uid: string | null }>> {
  const res = await request.get(
    `${FIRESTORE_EMULATOR}/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents/tournaments/${tid}/players`,
    { headers: { Authorization: "Bearer owner" } },
  );
  if (!res.ok()) {
    throw new Error(`listPlayers failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    documents?: Array<{ name: string; fields?: Record<string, unknown> }>;
  };
  return (body.documents ?? []).map((d) => {
    const m = d.name.match(/\/players\/([^/]+)$/);
    const uidField = d.fields?.uid as
      | { stringValue?: string; nullValue?: null }
      | undefined;
    return { id: m ? m[1] : d.name, uid: uidField?.stringValue ?? null };
  });
}

test.describe("Phase 1〜2: 受付代理（proxy receipt）", () => {
  test("organizer が名前のみ参加者を代理受付し、表示名を編集できる（uid=null）", async ({
    page,
    request,
    tournamentDashboardPage,
  }) => {
    const organizer = randomOrganizer("proxy-or");
    const { tid } = await seedOrganizerTournament(page, {
      organizer,
      tournamentName: "Proxy Receipt",
    });

    const dash = tournamentDashboardPage(tid);
    await dash.goto();

    // ---------- 「参加者を追加」→ ゲストタブ → 名前のみ代理受付 ----------
    await page.getByRole("button", { name: "参加者を追加" }).click();
    const dialog = page.getByRole("dialog", { name: /参加者を追加/ });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("tab", { name: "ゲストで追加" }).click();
    await dialog.getByLabel("表示名").fill("Guest-A");
    await Promise.all([
      expect(dialog).toBeHidden({ timeout: 15_000 }),
      dialog.getByRole("button", { name: /^追加$/ }).click(),
    ]);

    // ---------- 参加者一覧に「管理専用」バッジ付きで現れる ----------
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Guest-A")).toBeVisible();
    await expect(page.getByText("管理専用")).toBeVisible();

    // ---------- Firestore で uid=null の player doc を観測 ----------
    const beforeEdit = await listPlayers(request, tid);
    expect(beforeEdit.length).toBe(1);
    expect(beforeEdit[0].uid).toBeNull();
    const namedOnlyPid = beforeEdit[0].id;

    // ---------- ✏ → 表示名編集 → 反映 ----------
    await page.getByLabel("Guest-A の表示名を編集").click();
    const editDialog = page.getByRole("dialog", { name: /表示名を変更/ });
    await expect(editDialog).toBeVisible({ timeout: 10_000 });
    const editInput = editDialog.getByLabel("表示名");
    await editInput.fill("Guest-A2");
    await Promise.all([
      expect(editDialog).toBeHidden({ timeout: 15_000 }),
      editDialog.getByRole("button", { name: /^保存$/ }).click(),
    ]);
    await expect(page.getByText("Guest-A2")).toBeVisible({ timeout: 15_000 });

    // ---------- Firestore で displayName 反映 + 同一 pid + uid=null 維持 ----------
    const snap = await getDocument(request, `tournaments/${tid}/players/${namedOnlyPid}`);
    expect(snap.exists).toBe(true);
    const fields = (snap.data as { fields?: Record<string, unknown> }).fields ?? {};
    const displayName = (fields.displayName as { stringValue?: string } | undefined)?.stringValue;
    expect(displayName).toBe("Guest-A2");
    const uid = fields.uid as { nullValue?: null; stringValue?: string } | undefined;
    expect(uid?.stringValue ?? null).toBeNull();
  });

  test("organizer が招待コード加入メンバーを member タブから代理受付できる（uid=memberUid）", async ({
    page,
    request,
    tournamentDashboardPage,
  }) => {
    // ---------- owner（context A）が group / tournament / 招待コードを用意 ----------
    const owner = randomOrganizer("proxy-ow");
    const { gid, tid } = await seedOrganizerTournament(page, {
      organizer: owner,
      groupName: "Proxy Member Group",
      tournamentName: "Proxy Member Tournament",
    });
    const inviteUrl = await issueInviteUrl(page, gid);

    // ---------- メンバー（context B）が招待コードで加入する ----------
    // 加入後、group.memberDisplayNames に「proxy-mb-...」表示名が載り、
    // ダイアログの member タブ候補（<option value={uid}>）に現れる。
    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("proxy-mb");
      await registerOrganizer(memberPage, member);
      await consumeInviteUrl(memberPage, inviteUrl);
      await memberPage.close();
    } finally {
      await memberCtx.close();
    }

    // ---------- owner が dashboard で member タブから代理受付 ----------
    const dash = tournamentDashboardPage(tid);
    await dash.goto();
    await page.getByRole("button", { name: "参加者を追加" }).click();
    const dialog = page.getByRole("dialog", { name: /参加者を追加/ });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // member タブが初期表示。候補 select から「proxy-mb-...」表示名のメンバーを選ぶ。
    // getByLabel("メンバー") は tabpanel(aria-labelledby) と <select> の双方にマッチするため、
    // combobox role で <select> を一意に特定する。
    const select = dialog.getByRole("combobox", { name: "メンバー" });
    await expect(select).toBeVisible();
    // owner 自身も候補に含まれるため、proxy-mb prefix のオプションを value で選ぶ。
    const memberOptionValue = await select
      .locator("option")
      .filter({ hasText: /^proxy-mb-/ })
      .first()
      .getAttribute("value");
    if (!memberOptionValue) throw new Error("member option not found in select");
    await select.selectOption(memberOptionValue);
    await Promise.all([
      expect(dialog).toBeHidden({ timeout: 15_000 }),
      dialog.getByRole("button", { name: /^追加$/ }).click(),
    ]);

    // ---------- 参加者一覧に現れ、Firestore で pid==uid==memberUid を観測 ----------
    await expect(page.getByText(/参加者 \(1\)/)).toBeVisible({ timeout: 15_000 });
    const players = await listPlayers(request, tid);
    expect(players.length).toBe(1);
    // member-proxy は pid==uid（合成 id ではない）。uid が非 null で memberOptionValue と一致。
    expect(players[0].uid).toBe(memberOptionValue);
    expect(players[0].id).toBe(memberOptionValue);
  });
});
