import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmailPasswordFields, PASSWORD_MIN_LENGTH } from "./EmailPasswordFields";

/**
 * 08-auto-group-join-on-entry Phase 3: `/login` と `/join/[tid]` から共有される
 * メール ＋ パスワード入力欄の render 契約を固定する characterization test。
 *
 * `idPrefix` は同一画面での id 衝突（`getByLabel` の strict mode 違反）を避けるための
 * 契約なので、生成規則そのものを assert する。
 */
function renderFields(overrides: Partial<Parameters<typeof EmailPasswordFields>[0]> = {}) {
  return render(
    <EmailPasswordFields
      idPrefix="l"
      mode="login"
      email=""
      password=""
      onEmailChange={vi.fn()}
      onPasswordChange={vi.fn()}
      {...overrides}
    />,
  );
}

describe("EmailPasswordFields", () => {
  it("idPrefix から `${prefix}-email` / `${prefix}-password` の id を生成する", () => {
    renderFields({ idPrefix: "l" });

    expect(screen.getByLabelText("メールアドレス")).toHaveAttribute("id", "l-email");
    expect(screen.getByLabelText("パスワード")).toHaveAttribute("id", "l-password");
  });

  it("mode=login では autoComplete が current-password", () => {
    renderFields({ mode: "login" });

    expect(screen.getByLabelText("パスワード")).toHaveAttribute("autocomplete", "current-password");
  });

  it("mode=register では autoComplete が new-password", () => {
    renderFields({ mode: "register" });

    expect(screen.getByLabelText("パスワード")).toHaveAttribute("autocomplete", "new-password");
  });

  it("passwordMinLength 未指定なら minLength 属性を付けない（/join ログインタブ非回帰）", () => {
    renderFields();

    expect(screen.getByLabelText("パスワード")).not.toHaveAttribute("minlength");
  });

  it("passwordMinLength を渡すと minLength 属性が付く", () => {
    renderFields({ passwordMinLength: PASSWORD_MIN_LENGTH });

    expect(screen.getByLabelText("パスワード")).toHaveAttribute("minlength", "6");
  });

  it("メール欄は type=email / autoComplete=email / required", () => {
    renderFields();

    const emailInput = screen.getByLabelText("メールアドレス");
    expect(emailInput).toHaveAttribute("type", "email");
    expect(emailInput).toHaveAttribute("autocomplete", "email");
    expect(emailInput).toBeRequired();
  });
});
