import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WinnerCardDownloadButton } from "./WinnerCardDownloadButton";

const FIXED_FINISHED_AT = new Date("2026-05-06T12:00:00.000Z");

describe("WinnerCardDownloadButton", () => {
  it("href が buildWinnerCardUrl の出力と一致する", () => {
    render(
      <WinnerCardDownloadButton
        tid="t-123"
        winnerName="Alice"
        tournamentName="サタデートーナメント"
        participants={8}
        finishedAt={FIXED_FINISHED_AT}
      />,
    );
    const a = screen.getByTestId("winner-card-download") as HTMLAnchorElement;
    expect(a.getAttribute("href")).toMatch(/^\/api\/og\/winner\/t-123\?/);
    const sp = new URLSearchParams(a.getAttribute("href")!.split("?")[1]);
    expect(sp.get("winnerName")).toBe("Alice");
    expect(sp.get("tournamentName")).toBe("サタデートーナメント");
    expect(sp.get("participants")).toBe("8");
    // 端末 TZ で format された日付ラベルが渡される（YYYY/M/D 形式）
    expect(sp.get("finishedAtLabel")).toMatch(/^\d{4}\/\d{1,2}\/\d{1,2}$/);
  });

  it("finishedAtLabel は端末 TZ で format される（toLocaleDateString と同等）", () => {
    render(
      <WinnerCardDownloadButton
        tid="t-1"
        winnerName="A"
        tournamentName="T"
        participants={1}
        finishedAt={FIXED_FINISHED_AT}
      />,
    );
    const a = screen.getByTestId("winner-card-download") as HTMLAnchorElement;
    const sp = new URLSearchParams(a.getAttribute("href")!.split("?")[1]);
    // node 実行環境の TZ で format した結果と一致するか
    expect(sp.get("finishedAtLabel")).toBe(
      FIXED_FINISHED_AT.toLocaleDateString("ja-JP"),
    );
  });

  it("filename と filename query の stem は一致する（route の Content-Disposition と整合）", () => {
    render(
      <WinnerCardDownloadButton
        tid="t-1"
        winnerName="Alice"
        tournamentName="サタデートーナメント"
        participants={8}
        finishedAt={FIXED_FINISHED_AT}
      />,
    );
    const a = screen.getByTestId("winner-card-download") as HTMLAnchorElement;
    const dl = a.getAttribute("download")!;
    const sp = new URLSearchParams(a.getAttribute("href")!.split("?")[1]);
    const filenameQuery = sp.get("filename");
    expect(filenameQuery).not.toBeNull();
    expect(dl).toBe(`${filenameQuery}.png`);
  });

  it("filename が ASCII safe で日付を含む", () => {
    render(
      <WinnerCardDownloadButton
        tid="t-1"
        winnerName="Alice"
        tournamentName="サタデートーナメント"
        participants={8}
        finishedAt={FIXED_FINISHED_AT}
      />,
    );
    const a = screen.getByTestId("winner-card-download") as HTMLAnchorElement;
    const dl = a.getAttribute("download")!;
    expect(dl).toMatch(/^winner/);
    // 端末 TZ で format した日付（sv-SE = YYYY-MM-DD）が含まれる
    expect(dl).toMatch(
      new RegExp(FIXED_FINISHED_AT.toLocaleDateString("sv-SE")),
    );
    expect(dl).toMatch(/\.png$/);
    expect(dl).not.toMatch(/[^\x00-\x7F]/);
  });

  it("tid に特殊文字が含まれても URL が壊れない", () => {
    render(
      <WinnerCardDownloadButton
        tid="t/123"
        winnerName="Alice"
        tournamentName="Cup"
        participants={4}
        finishedAt={FIXED_FINISHED_AT}
      />,
    );
    const a = screen.getByTestId("winner-card-download") as HTMLAnchorElement;
    expect(a.getAttribute("href")).toContain("/api/og/winner/t%2F123?");
  });
});
