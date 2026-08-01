import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DisplayNameField } from "./DisplayNameField";

/**
 * 08-auto-group-join-on-entry Phase 3: `/login` と `/join/[tid]` から共有される
 * 表示名入力欄の render 契約を固定する characterization test。
 *
 * `15` は意図的に literal で書く（`DISPLAY_NAME_MAX_LENGTH` を import すると
 * 定数変更にテストが追従してしまい、rule 側 `size() <= 15` との drift を検出できない）。
 */
describe("DisplayNameField", () => {
  it("既定 props で表示名ラベル・15 字上限・既定 hint を描画する", () => {
    render(<DisplayNameField id="g-name" value="" onChange={vi.fn()} />);

    const input = screen.getByLabelText("表示名");
    expect(input).toHaveAttribute("maxlength", "15");
    expect(input).toBeRequired();
    expect(screen.getByText("15 文字以内で入力してください。")).toBeInTheDocument();
  });

  it("label / hint を上書きできる（/login の新規登録モード）", () => {
    render(
      <DisplayNameField
        id="reg-name"
        label="表示名（必須）"
        value=""
        onChange={vi.fn()}
        hint={<span>席表に表示される名前です。</span>}
      />,
    );

    expect(screen.getByLabelText("表示名（必須）")).toBeInTheDocument();
    expect(screen.getByText("席表に表示される名前です。")).toBeInTheDocument();
    // 既定 hint は上書きされて消える
    expect(screen.queryByText("15 文字以内で入力してください。")).toBeNull();
  });

  it("入力すると onChange に ChangeEvent ではなく文字列が渡る", () => {
    const onChange = vi.fn();
    render(<DisplayNameField id="g-name" value="" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("表示名"), { target: { value: "Alice" } });

    expect(onChange).toHaveBeenCalledWith("Alice");
  });

  it("id が label と input を結ぶ（/login の focus 制御が id 依存のため）", () => {
    render(<DisplayNameField id="reg-name" value="" onChange={vi.fn()} />);

    expect(screen.getByLabelText("表示名")).toHaveAttribute("id", "reg-name");
  });

  it("autoFocus を渡すと input に focus が当たる（DisplayNameDialog の必須入力導線）", () => {
    render(<DisplayNameField id="dn" value="" onChange={vi.fn()} autoFocus />);

    expect(screen.getByLabelText("表示名")).toHaveFocus();
  });

  it("autoFocus 未指定なら focus を奪わない（フォーム内に並べる callsite の既定）", () => {
    render(<DisplayNameField id="g-name" value="" onChange={vi.fn()} />);

    expect(screen.getByLabelText("表示名")).not.toHaveFocus();
  });

  it("className / inputClassName は既定 class に足す（/login の muted ボックス）", () => {
    const { container } = render(
      <DisplayNameField
        id="reg-name"
        value=""
        onChange={vi.fn()}
        className="rounded-md border bg-muted/50 p-4"
        inputClassName="bg-background"
      />,
    );

    // 既定の space-y-2 を置き換えではなく「追加」する。片方だけになると
    // /login 新規登録モードの枠（border + muted 背景）か行間のどちらかが崩れる。
    expect(container.firstElementChild).toHaveClass(
      "space-y-2",
      "rounded-md",
      "border",
      "bg-muted/50",
      "p-4",
    );
    expect(screen.getByLabelText("表示名")).toHaveClass("bg-background");
  });

  it("className 未指定なら wrapper は既定の space-y-2 のみ（/join のフォーム内）", () => {
    const { container } = render(<DisplayNameField id="g-name" value="" onChange={vi.fn()} />);

    expect(container.firstElementChild).toHaveClass("space-y-2");
    expect(container.firstElementChild?.className.trim()).toBe("space-y-2");
  });
});
