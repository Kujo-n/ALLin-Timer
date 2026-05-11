import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CardBackground } from "@/lib/firebase/schemas/group";

vi.mock("@/lib/firebase/AuthProvider", () => ({
  useAuthUser: () => ({
    user: { uid: "u-owner", isAnonymous: false, displayName: "Owner" },
    loading: false,
  }),
}));

vi.mock("@/lib/services/card-background", () => ({
  uploadAndSetWinnerCardBackground: vi.fn(),
  uploadAndSetSeasonCardBackground: vi.fn(),
  clearWinnerCardBackground: vi.fn(),
  clearSeasonCardBackground: vi.fn(),
  updateWinnerCardBackgroundTextTheme: vi.fn(),
  updateSeasonCardBackgroundTextTheme: vi.fn(),
}));

vi.mock("@/lib/utils/image-resize", () => ({
  resizeImageToCardSize: vi
    .fn()
    .mockResolvedValue(new Blob([new Uint8Array([9])], { type: "image/jpeg" })),
}));

import {
  clearWinnerCardBackground,
  updateWinnerCardBackgroundTextTheme,
  uploadAndSetWinnerCardBackground,
} from "@/lib/services/card-background";
import { resizeImageToCardSize } from "@/lib/utils/image-resize";

import { CardBackgroundCard } from "./CardBackgroundCard";

const setCurrent: CardBackground = {
  imageUrl: "https://x/current.jpg",
  storageAssetId: "asset-old",
  textTheme: "light",
};

beforeEach(() => {
  vi.mocked(resizeImageToCardSize).mockReset().mockResolvedValue(
    new Blob([new Uint8Array([9])], { type: "image/jpeg" }),
  );
  vi.mocked(uploadAndSetWinnerCardBackground).mockReset();
  vi.mocked(clearWinnerCardBackground).mockReset();
  vi.mocked(updateWinnerCardBackgroundTextTheme).mockReset();
  // jsdom には URL.createObjectURL / revokeObjectURL が無いため、初回は method を生やす。
  if (typeof URL.createObjectURL !== "function") {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL =
      () => "";
  }
  if (typeof URL.revokeObjectURL !== "function") {
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL =
      () => {};
  }
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CardBackgroundCard - winner", () => {
  it("canEdit=false: ファイル選択 / 保存 / 解除ボタンは render されない", () => {
    render(
      <CardBackgroundCard
        gid="g1"
        kind="winner"
        current={null}
        canEdit={false}
        onSaved={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /ファイルを選択/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /保存/ })).toBeNull();
    expect(screen.getByText("背景未設定")).toBeInTheDocument();
  });

  it("canEdit=true / current=null: 「背景未設定」プレビュー + 保存ボタン disabled", () => {
    render(
      <CardBackgroundCard
        gid="g1"
        kind="winner"
        current={null}
        canEdit={true}
        onSaved={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(screen.getByText("背景未設定")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^保存$/ })).toBeDisabled();
    // current=null のときは「背景を解除」ボタンも出さない
    expect(screen.queryByRole("button", { name: /背景を解除/ })).toBeNull();
  });

  it("canEdit=true / current あり: 既存画像が `<img>` で表示される + 解除ボタン visible", () => {
    render(
      <CardBackgroundCard
        gid="g1"
        kind="winner"
        current={setCurrent}
        canEdit={true}
        onSaved={vi.fn()}
        onError={vi.fn()}
      />,
    );
    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe(setCurrent.imageUrl);
    expect(
      screen.getByRole("button", { name: /背景を解除/ }),
    ).toBeInTheDocument();
  });

  it("5MB 超ファイル → onError 呼出 + resize / upload は呼ばれない", async () => {
    const onError = vi.fn();
    const onSaved = vi.fn();
    render(
      <CardBackgroundCard
        gid="g1"
        kind="winner"
        current={null}
        canEdit={true}
        onSaved={onSaved}
        onError={onError}
      />,
    );
    const big = new File(
      [new Uint8Array(6 * 1024 * 1024)],
      "big.jpg",
      { type: "image/jpeg" },
    );
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [big] } });
    });
    expect(onError).toHaveBeenCalledWith("画像は 5MB 以下を選択してください");
    expect(resizeImageToCardSize).not.toHaveBeenCalled();
  });

  it("非 image-mime → onError 呼出", async () => {
    const onError = vi.fn();
    render(
      <CardBackgroundCard
        gid="g1"
        kind="winner"
        current={null}
        canEdit={true}
        onSaved={vi.fn()}
        onError={onError}
      />,
    );
    const pdf = new File([new Uint8Array([1])], "x.pdf", {
      type: "application/pdf",
    });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [pdf] } });
    });
    expect(onError).toHaveBeenCalledWith(
      "画像形式は jpeg / png / webp を選択してください",
    );
    expect(resizeImageToCardSize).not.toHaveBeenCalled();
  });

  it("正常 jpg 選択 → resize → 保存可能 → save 経由で upload service 呼出 + onSaved", async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    vi.mocked(uploadAndSetWinnerCardBackground).mockResolvedValue();
    render(
      <CardBackgroundCard
        gid="g1"
        kind="winner"
        current={null}
        canEdit={true}
        onSaved={onSaved}
        onError={onError}
      />,
    );

    const good = new File([new Uint8Array([1, 2, 3])], "good.jpg", {
      type: "image/jpeg",
    });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [good] } });
    // onChange 内の async onFileChange は fire-and-forget で起動するため、
    // resize 完了後の setState 反映を waitFor で待つ。
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^保存$/ })).not.toBeDisabled();
    });
    expect(resizeImageToCardSize).toHaveBeenCalledTimes(1);

    const saveBtn = screen.getByRole("button", { name: /^保存$/ });
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    expect(uploadAndSetWinnerCardBackground).toHaveBeenCalledTimes(1);
    expect(uploadAndSetWinnerCardBackground).toHaveBeenCalledWith(
      expect.objectContaining({
        gid: "g1",
        uid: "u-owner",
        textTheme: "light",
        previousAssetId: null,
      }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("保存失敗 → onError 呼出 + working は false に戻る", async () => {
    const onSaved = vi.fn();
    const onError = vi.fn();
    vi.mocked(uploadAndSetWinnerCardBackground).mockRejectedValue(
      Object.assign(new Error("up"), { code: "storage/upload-failed" }),
    );
    render(
      <CardBackgroundCard
        gid="g1"
        kind="winner"
        current={null}
        canEdit={true}
        onSaved={onSaved}
        onError={onError}
      />,
    );
    const good = new File([new Uint8Array([1])], "g.jpg", {
      type: "image/jpeg",
    });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [good] } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^保存$/ })).not.toBeDisabled();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));
    });
    expect(onError).toHaveBeenCalledTimes(1);
    // 保存ボタンは disabled に戻る（preview がクリアされていないので「保存」可能）
    // - resetSelection を save 成功 path のみで呼ぶため、保存失敗時は previewBlob を保持。
    //   その挙動を反映して「失敗後はボタンが押せる」ことを確認する。
    expect(screen.getByRole("button", { name: /^保存$/ })).not.toBeDisabled();
  });

  it("「背景を解除」→ window.confirm 通過 → clear service + onSaved", async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    vi.mocked(clearWinnerCardBackground).mockResolvedValue();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <CardBackgroundCard
        gid="g1"
        kind="winner"
        current={setCurrent}
        canEdit={true}
        onSaved={onSaved}
        onError={onError}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /背景を解除/ }));
    });
    expect(clearWinnerCardBackground).toHaveBeenCalledWith({
      gid: "g1",
      uid: "u-owner",
      previousAssetId: "asset-old",
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("textTheme radio で「ダーク」を選択 → 保存 → updateTextTheme 呼出（upload は呼ばれない）", async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined);
    vi.mocked(updateWinnerCardBackgroundTextTheme).mockResolvedValue();
    render(
      <CardBackgroundCard
        gid="g1"
        kind="winner"
        current={setCurrent}
        canEdit={true}
        onSaved={onSaved}
        onError={vi.fn()}
      />,
    );

    // radio "ダーク" を選択
    const dark = screen.getByLabelText("ダーク");
    await act(async () => {
      fireEvent.click(dark);
    });
    // 保存
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));
    });
    expect(updateWinnerCardBackgroundTextTheme).toHaveBeenCalledTimes(1);
    expect(updateWinnerCardBackgroundTextTheme).toHaveBeenCalledWith({
      gid: "g1",
      uid: "u-owner",
      current: setCurrent,
      textTheme: "dark",
    });
    expect(uploadAndSetWinnerCardBackground).not.toHaveBeenCalled();
  });
});
