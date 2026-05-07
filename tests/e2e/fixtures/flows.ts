import { expect, type Page } from "@playwright/test";

/**
 * UI 経由のセットアップフロー。E2E のテスト冒頭で使う。
 *
 * 原則として Server Actions や Admin SDK を使わず、実ユーザ操作と同じ経路で
 * 「運営者として登録済み + group + structure + tournament(setup)」状態を作る。
 *
 * いずれの helper もログイン状態を維持する（page は同一セッション）。
 */

interface OrganizerCredentials {
  email: string;
  password: string;
  displayName: string;
}

export function randomOrganizer(prefix = "op"): OrganizerCredentials {
  const suffix = Math.random().toString(36).slice(2, 8);
  // Phase 4.7: displayName は 15 文字上限（`DISPLAY_NAME_MAX_LENGTH`）。
  // `<Input maxLength>` は先頭 15 文字のみ残すため、それを超える値を assertion で
  // 使うと listitem 一致が壊れる。prefix は suffix と区切り文字含めて 15 文字以内に収める。
  const fullName = `${prefix}-${suffix}`;
  const displayName = fullName.slice(0, 15);
  return {
    email: `${prefix}-${suffix}@e2e.local`,
    password: "pass123456",
    displayName,
  };
}

/** /login の 新規登録タブから organizer アカウントを作成。 */
export async function registerOrganizer(page: Page, creds: OrganizerCredentials): Promise<void> {
  await page.goto("/login");
  await page.getByRole("tab", { name: "新規登録" }).click();
  await page.getByLabel("表示名").fill(creds.displayName);
  await page.getByLabel("メールアドレス").fill(creds.email);
  await page.getByLabel("パスワード").fill(creds.password);
  // exact: true で「Google で新規登録」と衝突させない（substring match の default を回避）
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }),
    page.getByRole("button", { name: "新規登録", exact: true }).click(),
  ]);
}

/** /groups/new から作成 → 遷移した `/groups/[gid]` の gid を返す。 */
export async function createGroup(page: Page, name: string): Promise<string> {
  await page.goto("/groups/new");
  await page.getByLabel("サークル名").fill(name);
  await Promise.all([
    // `/groups/new` にマッチしないよう negative lookahead で除外。
    page.waitForURL(
      (url) => {
        const m = url.pathname.match(/^\/groups\/([^/]+)$/);
        return m !== null && m[1] !== "new" && m[1] !== "join";
      },
      { timeout: 15_000 },
    ),
    page.getByRole("button", { name: /^作成$/ }).click(),
  ]);
  const m = page.url().match(/\/groups\/([^/?#]+)/);
  if (!m) throw new Error(`failed to parse gid from ${page.url()}`);
  return m[1];
}

/** /structures/new から最小のストラクチャを作成（default の 2 レベルを利用）。 */
export async function createDefaultStructure(page: Page, name: string): Promise<void> {
  await page.goto("/structures/new");
  await page.getByLabel("ストラクチャ名").fill(name);
  await Promise.all([
    page.waitForURL("**/structures", { timeout: 15_000 }),
    page.getByRole("button", { name: /^作成$/ }).click(),
  ]);
}

/**
 * Phase 4.8: `/templates/new` からストラクチャテンプレートを作成し、
 * 完了後に `/templates` へ戻るまで待つ。
 *
 * 既存フォームの default level（2 件）を利用するため、最小入力は名前のみ。
 * `description` と `initialStack` は明示指定された場合のみ上書きする。
 */
export async function createTemplateViaUI(
  page: Page,
  options: {
    name: string;
    description?: string;
    initialStack?: number;
  },
): Promise<void> {
  await page.goto("/templates/new");
  await page.getByLabel("テンプレート名").fill(options.name);
  if (options.description !== undefined) {
    await page.getByLabel("説明（任意）").fill(options.description);
  }
  if (options.initialStack !== undefined) {
    const stack = page.getByLabel("初期スタック");
    await stack.fill(String(options.initialStack));
  }
  await Promise.all([
    page.waitForURL("**/templates", { timeout: 15_000 }),
    page.getByRole("button", { name: /^作成$/ }).click(),
  ]);
}

/** /tournaments/new から作成 → 遷移した `/tournaments/[tid]` の tid を返す。 */
export async function createTournament(
  page: Page,
  name: string,
  seatsPerTable = 9,
): Promise<string> {
  await page.goto("/tournaments/new");
  await page.getByLabel("トーナメント名").fill(name);
  const seats = page.getByLabel("1 Table あたりの席数");
  await seats.fill(String(seatsPerTable));
  await Promise.all([
    // `/tournaments/new` にマッチしないよう negative lookahead で除外。
    page.waitForURL(
      (url) => {
        const m = url.pathname.match(/^\/tournaments\/([^/]+)$/);
        return m !== null && m[1] !== "new";
      },
      { timeout: 15_000 },
    ),
    page.getByRole("button", { name: /^作成$/ }).click(),
  ]);
  const m = page.url().match(/\/tournaments\/([^/?#]+)/);
  if (!m) throw new Error(`failed to parse tid from ${page.url()}`);
  return m[1];
}

/**
 * 組織者登録 → group → structure → tournament(setup) まで一括作成。
 * Phase 4.5 のテストで共通の初期状態。
 */
export async function seedOrganizerTournament(
  page: Page,
  options: {
    organizer: OrganizerCredentials;
    groupName?: string;
    structureName?: string;
    tournamentName?: string;
    seatsPerTable?: number;
  },
): Promise<{ gid: string; tid: string }> {
  await registerOrganizer(page, options.organizer);
  const gid = await createGroup(page, options.groupName ?? "E2E サークル");
  await createDefaultStructure(page, options.structureName ?? "E2E Default");
  const tid = await createTournament(
    page,
    options.tournamentName ?? "E2E Tournament",
    options.seatsPerTable ?? 9,
  );
  return { gid, tid };
}

/** 新しい context ページから匿名ゲストとして受付する。 */
export async function joinAsGuest(
  page: Page,
  tid: string,
  displayName: string,
): Promise<void> {
  await page.goto(`/join/${tid}`);
  await page.getByRole("tab", { name: "ゲスト" }).click();
  await page.getByLabel("表示名").fill(displayName);
  await page.getByRole("button", { name: /ゲストで受付/ }).click();
  // Cold emulator では signInAnonymously + 2 Firestore writes に時間が掛かるため 30s 許容。
  // shadcn の CardTitle は <div> 実装で role=heading を持たないので getByText を使う。
  await expect(page.getByText(/受付完了|既に参加済み/)).toBeVisible({ timeout: 30_000 });
}

/**
 * Phase 4.6: オーナーが `/groups/[gid]` で招待コードを発行し、その URL を返す。
 * 発行ボタン押下後、readonly Input に表示されるフル URL を読み取る。
 */
export async function issueInviteUrl(page: Page, gid: string): Promise<string> {
  await page.goto(`/groups/${gid}`);
  await page.getByRole("button", { name: "招待コードを発行" }).click();
  const input = page.locator('input[readonly]').first();
  await expect(input).toBeVisible({ timeout: 15_000 });
  const url = await input.inputValue();
  if (!url.includes("/groups/join/")) {
    throw new Error(`unexpected invite url: ${url}`);
  }
  return url;
}

/**
 * Phase 4.6: 招待コード URL を踏んで一般メンバーとして加入する。
 * 加入成功後、`/groups/[gid]` にリダイレクトされることを確認。
 */
export async function consumeInviteUrl(page: Page, inviteUrl: string): Promise<string> {
  const url = new URL(inviteUrl);
  await page.goto(url.pathname);
  await page.waitForURL(
    (u) => {
      const m = u.pathname.match(/^\/groups\/([^/]+)$/);
      return m !== null && m[1] !== "new" && m[1] !== "join";
    },
    { timeout: 15_000 },
  );
  const m = page.url().match(/\/groups\/([^/?#]+)/);
  if (!m) throw new Error(`failed to parse gid from ${page.url()}`);
  return m[1];
}
