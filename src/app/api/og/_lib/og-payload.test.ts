import { describe, expect, it } from "vitest";

import {
  buildSeasonCardUrl,
  buildSeasonShareInputs,
  buildWinnerCardUrl,
  buildWinnerShareInputs,
  cardBackgroundQueryFields,
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

describe("Phase A.2: bg query fields", () => {
  it("WINNER schema は bgImageUrl/bgTextTheme を optional で受け取る", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "Alice",
      tournamentName: "サタデー",
      participants: "8",
      finishedAtLabel: VALID_LABEL,
      bgImageUrl: "https://firebasestorage.googleapis.com/v0/b/x/o/y.jpg",
      bgTextTheme: "dark",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.bgTextTheme).toBe("dark");
    }
  });

  it("WINNER schema: bgImageUrl が URL でない場合 reject", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "Alice",
      tournamentName: "サタデー",
      participants: "8",
      finishedAtLabel: VALID_LABEL,
      bgImageUrl: "not-a-url",
    });
    expect(r.success).toBe(false);
  });

  it("WINNER schema: bgImageUrl が非 allowlist ホストの場合 reject（SSRF 防御）", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "Alice",
      tournamentName: "サタデー",
      participants: "8",
      finishedAtLabel: VALID_LABEL,
      bgImageUrl: "https://attacker.example.com/a.jpg",
    });
    expect(r.success).toBe(false);
  });

  it("WINNER schema: bgImageUrl が HTTP（非 HTTPS）の場合 reject", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "Alice",
      tournamentName: "サタデー",
      participants: "8",
      finishedAtLabel: VALID_LABEL,
      bgImageUrl: "http://firebasestorage.googleapis.com/v0/b/x/o/y.jpg",
    });
    expect(r.success).toBe(false);
  });

  it("SEASON schema: bgImageUrl の host allowlist も同様に強制", () => {
    const r = SEASON_CARD_QUERY_SCHEMA.safeParse({
      groupName: "G",
      seasonStartDateLabel: null,
      top1Name: "Alice",
      top1Points: "10",
      bgImageUrl: "https://169.254.169.254/meta",
    });
    expect(r.success).toBe(false);
  });

  it("WINNER schema: bgImageUrl 未指定でも pass する（既存挙動）", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "Alice",
      tournamentName: "サタデー",
      participants: "8",
      finishedAtLabel: VALID_LABEL,
    });
    expect(r.success).toBe(true);
  });

  it("SEASON schema も同様に bgImageUrl / bgTextTheme を受け取る", () => {
    const r = SEASON_CARD_QUERY_SCHEMA.safeParse({
      groupName: "G",
      seasonStartDateLabel: null,
      top1Name: "Alice",
      top1Points: "10",
      bgImageUrl: "https://firebasestorage.googleapis.com/v0/b/x/o/y.png",
      bgTextTheme: "light",
    });
    expect(r.success).toBe(true);
  });

  it("buildWinnerCardUrl: bgImageUrl 指定で URL に展開される", () => {
    const url = buildWinnerCardUrl("t-1", {
      winnerName: "Alice",
      tournamentName: "T",
      participants: 8,
      finishedAtLabel: VALID_LABEL,
      bgImageUrl: "https://x.example.com/a.jpg",
      bgTextTheme: "dark",
    });
    const sp = new URLSearchParams(url.split("?")[1]);
    expect(sp.get("bgImageUrl")).toBe("https://x.example.com/a.jpg");
    expect(sp.get("bgTextTheme")).toBe("dark");
  });

  it("cardBackgroundQueryFields: imageUrl null のとき空オブジェクト", () => {
    const out = cardBackgroundQueryFields({
      imageUrl: null,
      storageAssetId: null,
      textTheme: "light",
    });
    expect(out).toEqual({});
  });

  it("cardBackgroundQueryFields: imageUrl 非 null のとき 2 key を返す", () => {
    const out = cardBackgroundQueryFields({
      imageUrl: "https://x/y",
      storageAssetId: "a",
      textTheme: "dark",
    });
    expect(out).toEqual({ bgImageUrl: "https://x/y", bgTextTheme: "dark" });
  });

  it("cardBackgroundQueryFields: null / undefined はすべて空", () => {
    expect(cardBackgroundQueryFields(null)).toEqual({});
    expect(cardBackgroundQueryFields(undefined)).toEqual({});
  });

  it("buildWinnerShareInputs: cardBackground 渡しで URL に bgImageUrl が含まれる", () => {
    const r = buildWinnerShareInputs("t-1", {
      winnerName: "A",
      tournamentName: "T",
      participants: 8,
      finishedAt: new Date("2026-05-06T12:00:00Z"),
      cardBackground: {
        imageUrl: "https://x/bg.jpg",
        storageAssetId: "asset1",
        textTheme: "dark",
      },
    });
    const sp = new URLSearchParams(r.url.split("?")[1]);
    expect(sp.get("bgImageUrl")).toBe("https://x/bg.jpg");
    expect(sp.get("bgTextTheme")).toBe("dark");
  });

  it("buildWinnerShareInputs: cardBackground 未指定で bgImageUrl key が含まれない（既存挙動と一致）", () => {
    const r = buildWinnerShareInputs("t-1", {
      winnerName: "A",
      tournamentName: "T",
      participants: 8,
      finishedAt: new Date("2026-05-06T12:00:00Z"),
    });
    const sp = new URLSearchParams(r.url.split("?")[1]);
    expect(sp.has("bgImageUrl")).toBe(false);
    expect(sp.has("bgTextTheme")).toBe(false);
  });

  it("buildWinnerShareInputs: cardBackground.imageUrl=null のとき bgImageUrl は含まれない", () => {
    const r = buildWinnerShareInputs("t-1", {
      winnerName: "A",
      tournamentName: "T",
      participants: 8,
      finishedAt: new Date("2026-05-06T12:00:00Z"),
      cardBackground: { imageUrl: null, storageAssetId: null, textTheme: "light" },
    });
    const sp = new URLSearchParams(r.url.split("?")[1]);
    expect(sp.has("bgImageUrl")).toBe(false);
  });

  it("buildSeasonShareInputs: options.cardBackground を URL に展開", () => {
    const startedDate = new Date("2026-04-01T15:00:00.000Z");
    const r = buildSeasonShareInputs(
      "g-1",
      { name: "G", seasonStartDate: { toDate: () => startedDate } },
      [{ displayName: "Alice", totalPoints: 10 }],
      {
        cardBackground: {
          imageUrl: "https://x/season.png",
          storageAssetId: "s1",
          textTheme: "dark",
        },
      },
    );
    expect(r).not.toBeNull();
    if (!r) return;
    const sp = new URLSearchParams(r.url.split("?")[1]);
    expect(sp.get("bgImageUrl")).toBe("https://x/season.png");
    expect(sp.get("bgTextTheme")).toBe("dark");
  });
});

describe("buildWinnerShareInputs", () => {
  const finishedAt = new Date("2026-05-06T12:00:00.000Z");
  const datePart = formatDateForFilename(finishedAt);

  it("filenameStem は sanitize 済みで `winner-<tname>-<datePart>` を含む", () => {
    const r = buildWinnerShareInputs("t-1", {
      winnerName: "Alice",
      tournamentName: "Saturday-Cup",
      participants: 8,
      finishedAt,
    });
    expect(r.filenameStem).toBe(`winner-Saturday-Cup-${datePart}`);
  });

  it("tournamentName に日本語が混じれば sanitize されて _ に置換される", () => {
    const r = buildWinnerShareInputs("t-1", {
      winnerName: "Alice",
      tournamentName: "サタデー",
      participants: 8,
      finishedAt,
    });
    // 4 文字の日本語は 4 つの _ に変換され、collapse で 1 つにまとまる：
    //   "winner-サタデー-<date>" → "winner-____-<date>" → "winner-_-<date>"
    // 先頭末尾の _ ではないため trim はかからない。
    expect(r.filenameStem).toBe(`winner-_-${datePart}`);
  });

  it("url は buildWinnerCardUrl と同じ形式 + filenameStem を filename クエリに含む", () => {
    const r = buildWinnerShareInputs("t-1", {
      winnerName: "Alice",
      tournamentName: "Saturday",
      participants: 8,
      finishedAt,
    });
    expect(r.url.startsWith("/api/og/winner/t-1?")).toBe(true);
    const sp = new URLSearchParams(r.url.split("?")[1]);
    expect(sp.get("winnerName")).toBe("Alice");
    expect(sp.get("tournamentName")).toBe("Saturday");
    expect(sp.get("participants")).toBe("8");
    expect(sp.get("finishedAtLabel")).toBe(formatDateForLabel(finishedAt));
    expect(sp.get("filename")).toBe(r.filenameStem);
  });

  it("download / share helper の出力は同一（drift しない）", () => {
    // download ボタン内の手書き計算と本 helper が同型を返すことを characterize する
    const datePart2 = formatDateForFilename(finishedAt);
    const expectedFilename = sanitizeFilename(`winner-Saturday-${datePart2}`);
    const expectedUrl = buildWinnerCardUrl("t-1", {
      winnerName: "Alice",
      tournamentName: "Saturday",
      participants: 8,
      finishedAtLabel: formatDateForLabel(finishedAt),
      filename: expectedFilename,
    });
    const r = buildWinnerShareInputs("t-1", {
      winnerName: "Alice",
      tournamentName: "Saturday",
      participants: 8,
      finishedAt,
    });
    expect(r).toEqual({ url: expectedUrl, filenameStem: expectedFilename });
  });
});

describe("buildSeasonShareInputs", () => {
  const startedDate = new Date("2026-04-01T15:00:00.000Z");
  const fakeStart = { toDate: () => startedDate };

  it("stats が空配列なら null を返す", () => {
    const r = buildSeasonShareInputs(
      "g-1",
      { name: "G", seasonStartDate: null },
      [],
    );
    expect(r).toBeNull();
  });

  it("seasonStartDate=null のとき datePart は `open` で url に seasonStartDateLabel が出ない", () => {
    const r = buildSeasonShareInputs(
      "g-1",
      { name: "Saturday-Circle", seasonStartDate: null },
      [{ displayName: "Alice", totalPoints: 10 }],
    );
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.filenameStem).toBe("season-Saturday-Circle-open");
    const sp = new URLSearchParams(r.url.split("?")[1]);
    expect(sp.has("seasonStartDateLabel")).toBe(false);
    expect(sp.get("groupName")).toBe("Saturday-Circle");
    expect(sp.get("top1Name")).toBe("Alice");
    expect(sp.get("filename")).toBe(r.filenameStem);
  });

  it("seasonStartDate あり + top1〜top3 を全部 url に展開する", () => {
    const r = buildSeasonShareInputs(
      "g-1",
      { name: "G", seasonStartDate: fakeStart },
      [
        { displayName: "Alice", totalPoints: 47.83 },
        { displayName: "Bob", totalPoints: 28.12 },
        { displayName: "Carol", totalPoints: 19.66 },
      ],
    );
    expect(r).not.toBeNull();
    if (!r) return;
    const sp = new URLSearchParams(r.url.split("?")[1]);
    expect(sp.get("groupName")).toBe("G");
    expect(sp.get("seasonStartDateLabel")).toBe(formatDateForLabel(startedDate));
    expect(sp.get("top1Name")).toBe("Alice");
    expect(sp.get("top1Points")).toBe("47.83");
    expect(sp.get("top2Name")).toBe("Bob");
    expect(sp.get("top2Points")).toBe("28.12");
    expect(sp.get("top3Name")).toBe("Carol");
    expect(sp.get("top3Points")).toBe("19.66");
    expect(sp.get("filename")).toBe(r.filenameStem);
  });

  it("stats が 1 件のみのときは top2/top3 key を url に出さない", () => {
    const r = buildSeasonShareInputs(
      "g-1",
      { name: "G", seasonStartDate: fakeStart },
      [{ displayName: "Alice", totalPoints: 10 }],
    );
    expect(r).not.toBeNull();
    if (!r) return;
    const sp = new URLSearchParams(r.url.split("?")[1]);
    expect(sp.has("top2Name")).toBe(false);
    expect(sp.has("top3Name")).toBe(false);
  });

  it("download / share helper の出力は同一（drift しない）", () => {
    const startDate = startedDate;
    const datePart = formatDateForFilename(startDate);
    const expectedFilename = sanitizeFilename(`season-G-${datePart}`);
    const expectedUrl = buildSeasonCardUrl("g-1", {
      groupName: "G",
      seasonStartDateLabel: formatDateForLabel(startDate),
      top1Name: "Alice",
      top1Points: 10,
      filename: expectedFilename,
    });
    const r = buildSeasonShareInputs(
      "g-1",
      { name: "G", seasonStartDate: fakeStart },
      [{ displayName: "Alice", totalPoints: 10 }],
    );
    expect(r).toEqual({ url: expectedUrl, filenameStem: expectedFilename });
  });
});
