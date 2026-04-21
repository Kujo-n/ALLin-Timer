import type { Page } from "@playwright/test";

/**
 * 全 POM の共通基底。
 * - `waitForStable`: HTML 読込完了まで待機
 *
 * NOTE: `networkidle` は使わない。Firestore の onSnapshot が永続コネクションを
 * 維持するため、dashboard / live を開いた瞬間から永遠に idle にならない。
 * Playwright の auto-waiting（getByRole 等）が要素の visibility を担保するので
 * 追加の待機は最小限で十分。
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  protected async waitForStable() {
    await this.page.waitForLoadState("domcontentloaded");
  }
}
