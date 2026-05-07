import { describe, expect, it } from "vitest";

import {
  formatSeasonShareText,
  formatWinnerShareText,
  truncateForShare,
} from "./share-text";

describe("formatWinnerShareText", () => {
  it("通常入力: トーナメント名 / 優勝者名 / 参加人数 を含む", () => {
    const text = formatWinnerShareText({
      tournamentName: "サタデートーナメント",
      winnerName: "Alice",
      participants: 8,
    });
    expect(text).toContain("サタデートーナメント");
    expect(text).toContain("Alice");
    expect(text).toContain("参加 8 人");
    expect(text).toContain("#ALLinPokerTimer");
  });

  it("winnerName が空白のみのときは '—' にフォールバック", () => {
    const text = formatWinnerShareText({
      tournamentName: "T",
      winnerName: "   ",
      participants: 1,
    });
    expect(text).toContain("優勝者は — です");
  });

  it("tournamentName が空のときは 'トーナメント' にフォールバック", () => {
    const text = formatWinnerShareText({
      tournamentName: "",
      winnerName: "Alice",
      participants: 1,
    });
    expect(text.startsWith("トーナメント の優勝者は")).toBe(true);
  });

  it("極端に長い名前でも 140 字以内に切り詰める", () => {
    const text = formatWinnerShareText({
      tournamentName: "あ".repeat(200),
      winnerName: "い".repeat(50),
      participants: 8,
    });
    expect(text.length).toBeLessThanOrEqual(140);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("formatSeasonShareText", () => {
  it("通常入力: サークル名 / 首位名 / pt を含む", () => {
    const text = formatSeasonShareText({
      groupName: "サタデーサークル",
      top1Name: "Alice",
      top1Points: 47.83,
    });
    expect(text).toContain("サタデーサークル");
    expect(text).toContain("Alice");
    expect(text).toContain("47.83 pt");
    expect(text).toContain("#ALLinPokerTimer");
  });

  it("top1Points = 0 のとき '0.00 pt' で表示", () => {
    const text = formatSeasonShareText({
      groupName: "G",
      top1Name: "Alice",
      top1Points: 0,
    });
    expect(text).toContain("0.00 pt");
  });

  it("top1Points = 1.234 のとき小数 2 桁に丸めて '1.23 pt' で表示", () => {
    const text = formatSeasonShareText({
      groupName: "G",
      top1Name: "Alice",
      top1Points: 1.234,
    });
    expect(text).toContain("1.23 pt");
  });

  it("groupName が空のときは 'サークル' にフォールバック", () => {
    const text = formatSeasonShareText({
      groupName: "",
      top1Name: "Alice",
      top1Points: 10,
    });
    expect(text.startsWith("サークル シーズン首位")).toBe(true);
  });
});

describe("truncateForShare", () => {
  it("max 以下の文字列はそのまま返す", () => {
    expect(truncateForShare("hello", 10)).toBe("hello");
  });

  it("max を超えると末尾を '…' にする", () => {
    expect(truncateForShare("0123456789", 5)).toBe("0123…");
  });
});
