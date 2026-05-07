import { describe, expect, it } from "vitest";

import {
  buildSeasonCardUrl,
  buildWinnerCardUrl,
  formatDateForFilename,
  formatDateForLabel,
  readSeasonCardQuery,
  sanitizeFilename,
  SEASON_CARD_QUERY_SCHEMA,
  WINNER_CARD_QUERY_SCHEMA,
} from "./og-payload";

const VALID_LABEL = "2026/5/6";

describe("WINNER_CARD_QUERY_SCHEMA", () => {
  it("通常入力を pass する", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "Alice",
      tournamentName: "サタデートーナメント",
      participants: "8",
      finishedAtLabel: VALID_LABEL,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.participants).toBe(8);
    }
  });

  it("filename optional を pass する", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "Alice",
      tournamentName: "サタデー",
      participants: "8",
      finishedAtLabel: VALID_LABEL,
      filename: "winner-saturday-2026-05-06",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.filename).toBe("winner-saturday-2026-05-06");
  });

  it("winnerName が空文字なら reject", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "",
      tournamentName: "サタデー",
      participants: "8",
      finishedAtLabel: VALID_LABEL,
    });
    expect(r.success).toBe(false);
  });

  it("winnerName が DISPLAY_NAME_MAX_LENGTH+1 文字なら reject", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "あいうえおかきくけこさしすせそた", // 16 文字
      tournamentName: "サタデー",
      participants: "8",
      finishedAtLabel: VALID_LABEL,
    });
    expect(r.success).toBe(false);
  });

  it("finishedAtLabel が空文字なら reject", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "Alice",
      tournamentName: "サタデー",
      participants: "8",
      finishedAtLabel: "",
    });
    expect(r.success).toBe(false);
  });

  it("finishedAtLabel が 31 文字超なら reject", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "Alice",
      tournamentName: "サタデー",
      participants: "8",
      finishedAtLabel: "x".repeat(31),
    });
    expect(r.success).toBe(false);
  });

  it("participants=0 は reject", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "Alice",
      tournamentName: "サタデー",
      participants: "0",
      finishedAtLabel: VALID_LABEL,
    });
    expect(r.success).toBe(false);
  });

  it("participants=61 は reject（実用上限 60 = 6 卓 × 10 席）", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "Alice",
      tournamentName: "サタデー",
      participants: "61",
      finishedAtLabel: VALID_LABEL,
    });
    expect(r.success).toBe(false);
  });

  it("tournamentName が 60 文字超なら reject", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "Alice",
      tournamentName: "あ".repeat(61),
      participants: "8",
      finishedAtLabel: VALID_LABEL,
    });
    expect(r.success).toBe(false);
  });
});

describe("SEASON_CARD_QUERY_SCHEMA", () => {
  it("top1 のみで pass する（top2/top3 は optional）", () => {
    const r = SEASON_CARD_QUERY_SCHEMA.safeParse({
      groupName: "サタデーサークル",
      seasonStartDateLabel: "2026/4/1",
      top1Name: "Alice",
      top1Points: "47.83",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.top1Points).toBe(47.83);
      expect(r.data.top2Name).toBeUndefined();
    }
  });

  it("seasonStartDateLabel=null を許容する", () => {
    const r = SEASON_CARD_QUERY_SCHEMA.safeParse({
      groupName: "サタデーサークル",
      seasonStartDateLabel: null,
      top1Name: "Alice",
      top1Points: "10",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.seasonStartDateLabel).toBeNull();
    }
  });

  it("top1Points が小数を coerce で受け取る", () => {
    const r = SEASON_CARD_QUERY_SCHEMA.safeParse({
      groupName: "G",
      seasonStartDateLabel: null,
      top1Name: "Alice",
      top1Points: "8.66",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.top1Points).toBeCloseTo(8.66);
    }
  });

  it("top1Points が負値なら reject", () => {
    const r = SEASON_CARD_QUERY_SCHEMA.safeParse({
      groupName: "G",
      seasonStartDateLabel: null,
      top1Name: "Alice",
      top1Points: "-1",
    });
    expect(r.success).toBe(false);
  });

  it("top3 まで揃った入力を pass する", () => {
    const r = SEASON_CARD_QUERY_SCHEMA.safeParse({
      groupName: "G",
      seasonStartDateLabel: null,
      top1Name: "Alice",
      top1Points: "47.83",
      top2Name: "Bob",
      top2Points: "28.12",
      top3Name: "Carol",
      top3Points: "19.66",
    });
    expect(r.success).toBe(true);
  });
});

describe("buildWinnerCardUrl", () => {
  it("通常 tid + query を組み立てる", () => {
    const url = buildWinnerCardUrl("t-123", {
      winnerName: "Alice",
      tournamentName: "サタデー",
      participants: 8,
      finishedAtLabel: VALID_LABEL,
    });
    expect(url.startsWith("/api/og/winner/t-123?")).toBe(true);
    const sp = new URLSearchParams(url.split("?")[1]);
    expect(sp.get("winnerName")).toBe("Alice");
    expect(sp.get("participants")).toBe("8");
    expect(sp.get("finishedAtLabel")).toBe(VALID_LABEL);
  });

  it("filename が指定されたとき URL に含まれる", () => {
    const url = buildWinnerCardUrl("t-1", {
      winnerName: "A",
      tournamentName: "T",
      participants: 1,
      finishedAtLabel: VALID_LABEL,
      filename: "winner-T-2026-05-06",
    });
    const sp = new URLSearchParams(url.split("?")[1]);
    expect(sp.get("filename")).toBe("winner-T-2026-05-06");
  });

  it("filename が undefined のとき URL に含まれない", () => {
    const url = buildWinnerCardUrl("t-1", {
      winnerName: "A",
      tournamentName: "T",
      participants: 1,
      finishedAtLabel: VALID_LABEL,
    });
    const sp = new URLSearchParams(url.split("?")[1]);
    expect(sp.has("filename")).toBe(false);
  });

  it("tid に `/` `?` が含まれていれば encodeURIComponent で escape する", () => {
    const url = buildWinnerCardUrl("t/1?x", {
      winnerName: "A",
      tournamentName: "T",
      participants: 1,
      finishedAtLabel: VALID_LABEL,
    });
    expect(url.startsWith("/api/og/winner/t%2F1%3Fx?")).toBe(true);
  });
});

describe("buildSeasonCardUrl", () => {
  it("seasonStartDateLabel=null のとき URL に key を出さない", () => {
    const url = buildSeasonCardUrl("g-1", {
      groupName: "G",
      seasonStartDateLabel: null,
      top1Name: "Alice",
      top1Points: 10,
    });
    const sp = new URLSearchParams(url.split("?")[1]);
    expect(sp.has("seasonStartDateLabel")).toBe(false);
  });

  it("top2/top3 が undefined なら URL に key を出さない", () => {
    const url = buildSeasonCardUrl("g-1", {
      groupName: "G",
      seasonStartDateLabel: "2026/4/1",
      top1Name: "Alice",
      top1Points: 10,
    });
    const sp = new URLSearchParams(url.split("?")[1]);
    expect(sp.has("top2Name")).toBe(false);
    expect(sp.has("top3Name")).toBe(false);
  });

  it("top3 まで揃った場合は全 key を含む", () => {
    const url = buildSeasonCardUrl("g-1", {
      groupName: "G",
      seasonStartDateLabel: "2026/4/1",
      top1Name: "Alice",
      top1Points: 47.83,
      top2Name: "Bob",
      top2Points: 28.12,
      top3Name: "Carol",
      top3Points: 19.66,
    });
    const sp = new URLSearchParams(url.split("?")[1]);
    expect(sp.get("top1Points")).toBe("47.83");
    expect(sp.get("top2Name")).toBe("Bob");
    expect(sp.get("top3Points")).toBe("19.66");
  });
});

describe("readSeasonCardQuery", () => {
  it("seasonStartDateLabel キーが無いとき null を補完する", () => {
    const sp = new URLSearchParams("groupName=G&top1Name=A&top1Points=10");
    const obj = readSeasonCardQuery(sp);
    expect(obj.seasonStartDateLabel).toBeNull();
  });

  it("seasonStartDateLabel キーがあれば文字列のまま返す", () => {
    const sp = new URLSearchParams(
      `groupName=G&top1Name=A&top1Points=10&seasonStartDateLabel=${encodeURIComponent("2026/4/1")}`,
    );
    const obj = readSeasonCardQuery(sp);
    expect(obj.seasonStartDateLabel).toBe("2026/4/1");
  });
});

describe("sanitizeFilename", () => {
  it("英数字はそのまま通す", () => {
    expect(sanitizeFilename("winner-2026-05-06")).toBe("winner-2026-05-06");
  });

  it("日本語と特殊文字は `_` に置換", () => {
    expect(sanitizeFilename("サタデー/cup?2026")).toBe("cup_2026");
  });

  it("40 文字で切り詰める", () => {
    expect(sanitizeFilename("a".repeat(60)).length).toBe(40);
  });

  it("置換後すべて記号化された場合は 'card' フォールバック", () => {
    expect(sanitizeFilename("！？／")).toBe("card");
  });
});

describe("formatDateForFilename / formatDateForLabel", () => {
  it("formatDateForFilename は YYYY-MM-DD 形式（端末 TZ）", () => {
    const d = new Date("2026-05-06T12:00:00.000Z");
    const out = formatDateForFilename(d);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("formatDateForLabel は ja-JP の標準日付形式（端末 TZ）", () => {
    const d = new Date("2026-05-06T12:00:00.000Z");
    const out = formatDateForLabel(d);
    expect(out).toMatch(/^\d{4}\/\d{1,2}\/\d{1,2}$/);
  });
});
