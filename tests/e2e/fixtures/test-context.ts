import { test as base, type Page } from "@playwright/test";

import { LoginPage } from "../pages/LoginPage";
import { TopPage } from "../pages/TopPage";
import { GroupsPage, GroupNewPage, GroupDetailPage } from "../pages/GroupsPage";
import {
  TournamentsPage,
  TournamentNewPage,
  TournamentDashboardPage,
  LivePage,
} from "../pages/TournamentsPage";
import { JoinPage } from "../pages/JoinPage";
import { resetEmulators } from "./emulator";

/**
 * 全テストで共有するカスタム Playwright fixture。
 *  - `autoResetEmulator`: 各テスト前に Firestore + Auth Emulator を全消去
 *  - 各 POM インスタンスを lazy instantiate で公開
 */
export const test = base.extend<{
  autoResetEmulator: void;
  topPage: TopPage;
  loginPage: LoginPage;
  groupsPage: GroupsPage;
  groupNewPage: GroupNewPage;
  groupDetailPage: (gid: string) => GroupDetailPage;
  tournamentsPage: TournamentsPage;
  tournamentNewPage: TournamentNewPage;
  tournamentDashboardPage: (tid: string) => TournamentDashboardPage;
  livePage: (tid: string) => LivePage;
  joinPage: (tid: string) => JoinPage;
}>({
  autoResetEmulator: [
    async ({ request }, use) => {
      await resetEmulators(request);
      await use();
    },
    { auto: true },
  ],
  // Firebase Auth SDK の IndexedDB / localStorage を毎テスト前に明示的に消す。
  // Playwright の新 context は通常クリーンだが、onAuthStateChanged が dev server の
  // hot-reload と絡んで残留するケースが観測されたので防御的にゼロ化する。
  page: async ({ page }, use) => {
    await page.goto("about:blank");
    await page.context().clearCookies();
    await use(page);
  },
  topPage: async ({ page }, use) => use(new TopPage(page)),
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  groupsPage: async ({ page }, use) => use(new GroupsPage(page)),
  groupNewPage: async ({ page }, use) => use(new GroupNewPage(page)),
  groupDetailPage: async ({ page }, use) => use((gid: string) => new GroupDetailPage(page, gid)),
  tournamentsPage: async ({ page }, use) => use(new TournamentsPage(page)),
  tournamentNewPage: async ({ page }, use) => use(new TournamentNewPage(page)),
  tournamentDashboardPage: async ({ page }, use) =>
    use((tid: string) => new TournamentDashboardPage(page, tid)),
  livePage: async ({ page }, use) => use((tid: string) => new LivePage(page, tid)),
  joinPage: async ({ page }, use) => use((tid: string) => new JoinPage(page, tid)),
});

export { expect } from "@playwright/test";

/**
 * ログアウト状態でスタートするための helper。localStorage / sessionStorage / cookie を
 * クリアして fresh なセッションから始める。
 */
export async function startFresh(page: Page) {
  await page.context().clearCookies();
  await page.goto("/");
  // 一度何らかのページに訪問しないと localStorage にアクセスできない。
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });
}
