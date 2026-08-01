import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RemoveMemberDialog } from "./RemoveMemberDialog";

/**
 * Phase 4 (08-auto-group-join-on-entry): メンバー除外の確認モーダル。
 *
 * 固定する仕様:
 *   1. open 条件は `targetName !== null` の 1 点のみ（親は「対象行」を state に持ち、
 *      null 化＝閉じる）
 *   2. 対象名とサークル名の両方を本文に出す（誤操作防止の意思確認）
 *   3. 「除外する」→ onConfirm / 「キャンセル」→ onOpenChange(false)
 *   4. working=true で両ボタン disabled + ラベルが「除外中…」（連打防止）
 */
function renderDialog(props: Partial<Parameters<typeof RemoveMemberDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <RemoveMemberDialog
      targetName="一般花子"
      groupName="Saturday"
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      working={false}
      {...props}
    />,
  );
  return { onConfirm, onOpenChange };
}

describe("RemoveMemberDialog", () => {
  it("targetName が null のとき閉じている", () => {
    renderDialog({ targetName: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("targetName が非 null のとき開き、対象名とサークル名を表示する", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("メンバーを除外");
    // 「「一般花子」を「Saturday」から除外します。」— 対象・サークルの両方を明示。
    expect(dialog).toHaveTextContent("一般花子");
    expect(dialog).toHaveTextContent("Saturday");
    // 履歴が残ることを伝えるのは仕様（service が players / seasonStats を消さない）。
    expect(dialog).toHaveTextContent("シーズン戦績はそのまま残ります");
  });

  it("「除外する」で onConfirm、「キャンセル」で onOpenChange(false)", () => {
    const { onConfirm, onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "除外する" }));
    expect(onConfirm).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("working=true で両ボタンが disabled になりラベルが「除外中…」に変わる", () => {
    renderDialog({ working: true });
    expect(screen.getByRole("button", { name: "除外中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "キャンセル" })).toBeDisabled();
    // 実行中は確定ラベルが消えている（二重 submit の導線を残さない）。
    expect(screen.queryByRole("button", { name: "除外する" })).toBeNull();
  });
});
