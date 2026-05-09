import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

import {
  getLevelInfo,
  getNextBreakInfo,
  getRemainingMs,
  resolveRanking,
  shouldAutoAdvance,
} from "./timer";

const baseCreatedAt = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));
const t0 = Timestamp.fromDate(new Date("2026-04-20T10:00:00Z"));
const t0Ms = t0.toMillis();

function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t1",
    groupId: "g1",
    createdByUid: "u1",
    name: "Monthly",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [
        { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
        { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
        { level: 3, sb: 75, bb: 150, ante: 25, durationSec: 600, isBreak: false },
      ],
    },
    state: "running",
    startedAt: t0,
    levelStartedAt: t0,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 1,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    spectateEnabled: false,
    createdAt: baseCreatedAt,
    updatedAt: baseCreatedAt,
    ...overrides,
  };
}

describe("getLevelInfo", () => {
  it("returns current and next when in middle level", () => {
    const t = makeTournament({ currentLevel: 2 });
    const info = getLevelInfo(t);
    expect(info?.current.level).toBe(2);
    expect(info?.next?.level).toBe(3);
    expect(info?.levelIndex).toBe(1);
  });

  it("returns null when currentLevel is 0 (setup)", () => {
    const t = makeTournament({ state: "setup", currentLevel: 0 });
    expect(getLevelInfo(t)).toBeNull();
  });

  it("returns null when currentLevel exceeds levels count", () => {
    const t = makeTournament({ currentLevel: 99 });
    expect(getLevelInfo(t)).toBeNull();
  });

  it("returns null next when on the final level", () => {
    const t = makeTournament({ currentLevel: 3 });
    const info = getLevelInfo(t);
    expect(info?.current.level).toBe(3);
    expect(info?.next).toBeNull();
  });
});

describe("getRemainingMs", () => {
  it("returns null when state is setup", () => {
    const t = makeTournament({ state: "setup", currentLevel: 0 });
    expect(getRemainingMs(t, t0Ms)).toBeNull();
  });

  it("returns null when levelStartedAt is null (pending-write)", () => {
    const t = makeTournament({ levelStartedAt: null });
    expect(getRemainingMs(t, t0Ms + 5_000)).toBeNull();
  });

  it("returns 0 when state is finished and finishedAt is null", () => {
    // finishedAt 未確定（pending write 等）の防衛的フォールバック
    const t = makeTournament({ state: "finished", finishedAt: null });
    expect(getRemainingMs(t, t0Ms + 5_000)).toBe(0);
  });

  it("freezes remaining at finishedAt when finished (pause-style behavior)", () => {
    // 5 秒経過時点で finish した場合、残り 595s で表示が固定される
    const finishedAt = Timestamp.fromMillis(t0Ms + 5_000);
    const t = makeTournament({ state: "finished", finishedAt });
    expect(getRemainingMs(t, t0Ms + 60_000)).toBe(600_000 - 5_000);
    expect(getRemainingMs(t, t0Ms + 999_999)).toBe(600_000 - 5_000);
  });

  it("returns duration - elapsed when running", () => {
    const t = makeTournament();
    expect(getRemainingMs(t, t0Ms + 5_000)).toBe(600_000 - 5_000);
  });

  it("adds back pausedAccumMs to remaining when running (treats paused time as not elapsed)", () => {
    const t = makeTournament({ pausedAccumMs: 30_000 });
    // elapsed = 5s - 30s = -25s, duration - elapsed = 600 - (-25) = 625s
    expect(getRemainingMs(t, t0Ms + 5_000)).toBe(625_000);
  });

  it("returns 0 (clamped) when elapsed exceeds duration", () => {
    const t = makeTournament();
    expect(getRemainingMs(t, t0Ms + 700_000)).toBe(0);
  });

  it("freezes remaining at pausedAt when paused", () => {
    const pausedAt = Timestamp.fromMillis(t0Ms + 100_000);
    const t = makeTournament({ state: "paused", pausedAt });
    // remaining at pause is 600s - 100s = 500s
    // nowMs advance shouldn't change it
    expect(getRemainingMs(t, t0Ms + 200_000)).toBe(500_000);
    expect(getRemainingMs(t, t0Ms + 999_999)).toBe(500_000);
  });

  it("returns null when paused but pausedAt is missing", () => {
    const t = makeTournament({ state: "paused", pausedAt: null });
    expect(getRemainingMs(t, t0Ms + 5_000)).toBeNull();
  });

  it("returns null when level info missing (currentLevel out of range)", () => {
    const t = makeTournament({ currentLevel: 99 });
    expect(getRemainingMs(t, t0Ms + 5_000)).toBeNull();
  });
});

describe("getNextBreakInfo", () => {
  function withBreak() {
    return makeTournament({
      currentLevel: 1,
      structureSnapshot: {
        name: "with break",
        initialStack: 10000,
        rebuyStack: null,
        addOnStack: null,
        lateEntryDeadlineLevel: 6,
        levels: [
          { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
          { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
          { level: 3, sb: 0, bb: 0, ante: 0, durationSec: 300, isBreak: true },
          { level: 4, sb: 75, bb: 150, ante: 25, durationSec: 600, isBreak: false },
        ],
      },
    });
  }

  it("returns null when no break level remains", () => {
    const t = makeTournament();
    expect(getNextBreakInfo(t, 600_000)).toBeNull();
  });

  it("returns null when state is setup / seating / finished", () => {
    const t = withBreak();
    expect(getNextBreakInfo({ ...t, state: "setup" }, 600_000)).toBeNull();
    expect(getNextBreakInfo({ ...t, state: "seating" }, 600_000)).toBeNull();
    expect(getNextBreakInfo({ ...t, state: "finished" }, 600_000)).toBeNull();
  });

  it("computes etaMs as remainingMs + sum(durationSec) of intermediate levels", () => {
    const t = withBreak();
    // current=Lv1 (remaining 500s) + Lv2 (600s) → break at Lv3, eta=1100s
    const info = getNextBreakInfo(t, 500_000);
    expect(info?.level.level).toBe(3);
    expect(info?.levelsAhead).toBe(2);
    expect(info?.etaMs).toBe(500_000 + 600_000);
  });

  it("returns levelsAhead=0 when current level itself is a break", () => {
    const t = makeTournament({
      currentLevel: 3,
      structureSnapshot: {
        name: "now break",
        initialStack: 10000,
        rebuyStack: null,
        addOnStack: null,
        lateEntryDeadlineLevel: 6,
        levels: [
          { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
          { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
          { level: 3, sb: 0, bb: 0, ante: 0, durationSec: 300, isBreak: true },
        ],
      },
    });
    const info = getNextBreakInfo(t, 120_000);
    expect(info?.levelsAhead).toBe(0);
    expect(info?.etaMs).toBe(120_000);
  });

  it("falls back to current.durationSec when remainingMs is null", () => {
    const t = withBreak();
    const info = getNextBreakInfo(t, null);
    expect(info?.etaMs).toBe(600_000 + 600_000); // current full + Lv2 full
  });
});

/**
 * Phase 5.2: 進行中レベルの `durationSec` を mutate した直後の残時間が
 * 新しい値に追従することを documentation する characterization test。
 *
 * `getRemainingMs` は `info.current.durationSec * 1000` を毎回再評価するため、
 * `structureSnapshot.levels[i].durationSec` を書き換えるだけで残時間計算は
 * 自動的に新値ベースに切り替わる（pure function の数式が状態を持たないため）。
 * 将来のリファクタがこの性質を壊さないように lock する。
 */
describe("getRemainingMs after structureSnapshot.levels[i].durationSec mutation", () => {
  function withMutatedDuration(
    base: TournamentDoc,
    levelIndex: number,
    newDurationSec: number,
  ): TournamentDoc {
    return {
      ...base,
      structureSnapshot: {
        ...base.structureSnapshot,
        levels: base.structureSnapshot.levels.map((l, i) =>
          i === levelIndex ? { ...l, durationSec: newDurationSec } : l,
        ),
      },
    };
  }

  it("running 中に現在 Lv の durationSec を 600s → 900s に増やすと残時間が +300s する", () => {
    // currentLevel=2, levels[1].durationSec=600, elapsed=300s → 旧残: 300_000ms
    const t = makeTournament({ currentLevel: 2 });
    expect(getRemainingMs(t, t0Ms + 300_000)).toBe(300_000);
    const next = withMutatedDuration(t, 1, 900);
    // 新残: 900_000 - 300_000 = 600_000ms
    expect(getRemainingMs(next, t0Ms + 300_000)).toBe(600_000);
  });

  it("現在 Lv の durationSec を経過時間より短くすると 0 にクランプされ、shouldAutoAdvance が true になる", () => {
    // elapsed=600s（既に Lv 終了直前）, durationSec を 540s に短縮
    const t = makeTournament({ currentLevel: 1 });
    const next = withMutatedDuration(t, 0, 540);
    expect(getRemainingMs(next, t0Ms + 600_000)).toBe(0);
    expect(shouldAutoAdvance(next, t0Ms + 600_000)).toBe(true);
  });

  it("未来 Lv の durationSec 変更は現在 Lv の残時間に影響しない", () => {
    // currentLevel=1, levels[2].durationSec を変更
    const t = makeTournament({ currentLevel: 1 });
    const before = getRemainingMs(t, t0Ms + 5_000);
    const next = withMutatedDuration(t, 2, 1200);
    expect(getRemainingMs(next, t0Ms + 5_000)).toBe(before);
  });

  it("未来 Lv の durationSec 変更は getNextBreakInfo の etaMs を新値ベースで再計算する", () => {
    // break 含むストラクチャ: Lv1, Lv2, Lv3=break, Lv4
    const baseLevels = [
      { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
      { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
      { level: 3, sb: 0, bb: 0, ante: 0, durationSec: 300, isBreak: true },
      { level: 4, sb: 75, bb: 150, ante: 25, durationSec: 600, isBreak: false },
    ];
    const t = makeTournament({
      currentLevel: 1,
      structureSnapshot: {
        name: "with break",
        initialStack: 10000,
        rebuyStack: null,
        addOnStack: null,
        lateEntryDeadlineLevel: 6,
        levels: baseLevels,
      },
    });
    // 旧: 残 500s（Lv1） + 600s（Lv2） = 1_100_000ms
    expect(getNextBreakInfo(t, 500_000)?.etaMs).toBe(1_100_000);
    // Lv2 を 900s に延長 → 残 500s + 900s = 1_400_000ms
    const next = withMutatedDuration(t, 1, 900);
    expect(getNextBreakInfo(next, 500_000)?.etaMs).toBe(1_400_000);
  });
});

describe("shouldAutoAdvance", () => {
  it("returns true when running, remaining is 0 and not on final level", () => {
    const t = makeTournament({ currentLevel: 1 });
    expect(shouldAutoAdvance(t, t0Ms + 700_000)).toBe(true);
  });

  it("returns false when remaining > 0", () => {
    const t = makeTournament({ currentLevel: 1 });
    expect(shouldAutoAdvance(t, t0Ms + 5_000)).toBe(false);
  });

  it("returns false on final level even if remaining is 0", () => {
    const t = makeTournament({ currentLevel: 3 });
    expect(shouldAutoAdvance(t, t0Ms + 700_000)).toBe(false);
  });

  it("returns false when paused", () => {
    const pausedAt = Timestamp.fromMillis(t0Ms + 700_000);
    const t = makeTournament({ state: "paused", pausedAt });
    expect(shouldAutoAdvance(t, t0Ms + 999_999)).toBe(false);
  });

  it("returns false when finished", () => {
    const t = makeTournament({ state: "finished" });
    expect(shouldAutoAdvance(t, t0Ms + 700_000)).toBe(false);
  });

  it("returns false when levelStartedAt is null", () => {
    const t = makeTournament({ levelStartedAt: null });
    expect(shouldAutoAdvance(t, t0Ms + 700_000)).toBe(false);
  });
});

/**
 * Phase A: 順位導出の純関数。`finishTournament` の seasonStats 増分で利用するため、
 * 同 ms タイ・全員 active・空配列の境界も決定論的に動くことを characterization する。
 */
function makePlayer(overrides: Partial<PlayerDoc> = {}): PlayerDoc {
  return {
    id: "p1",
    displayName: "P1",
    uid: "p1",
    entryAt: Timestamp.fromMillis(t0Ms),
    isBusted: false,
    bustedAt: null,
    tableNum: null,
    seatNum: null,
    lastMovedAt: null,
    isPlayingDealer: false,
    ...overrides,
  };
}

describe("resolveRanking", () => {
  it("returns empty array for empty input", () => {
    expect(resolveRanking([])).toEqual([]);
  });

  it("places single active player at rank 1", () => {
    const winner = makePlayer({ id: "p1", uid: "u1", displayName: "Alice" });
    const r = resolveRanking([winner]);
    expect(r).toEqual([{ pid: "p1", rank: 1, uid: "u1", displayName: "Alice" }]);
  });

  it("ranks 1 active + 4 busted by bustedAt desc (active is rank 1)", () => {
    // bust order: p2(t+5s) bust 4th, p3(t+10s) bust 3rd, p4(t+20s) bust 2nd, p5(t+30s) bust 1st (last bust = rank 2)
    const p1 = makePlayer({
      id: "p1",
      uid: "u1",
      displayName: "Alice",
      entryAt: Timestamp.fromMillis(t0Ms),
    });
    const p2 = makePlayer({
      id: "p2",
      uid: "u2",
      displayName: "Bob",
      entryAt: Timestamp.fromMillis(t0Ms + 100),
      isBusted: true,
      bustedAt: Timestamp.fromMillis(t0Ms + 5_000),
    });
    const p3 = makePlayer({
      id: "p3",
      uid: "u3",
      displayName: "Carol",
      entryAt: Timestamp.fromMillis(t0Ms + 200),
      isBusted: true,
      bustedAt: Timestamp.fromMillis(t0Ms + 10_000),
    });
    const p4 = makePlayer({
      id: "p4",
      uid: "u4",
      displayName: "Dave",
      entryAt: Timestamp.fromMillis(t0Ms + 300),
      isBusted: true,
      bustedAt: Timestamp.fromMillis(t0Ms + 20_000),
    });
    const p5 = makePlayer({
      id: "p5",
      uid: "u5",
      displayName: "Eve",
      entryAt: Timestamp.fromMillis(t0Ms + 400),
      isBusted: true,
      bustedAt: Timestamp.fromMillis(t0Ms + 30_000),
    });
    const r = resolveRanking([p3, p1, p5, p2, p4]); // 入力順は混ぜる
    expect(r.map((x) => x.pid)).toEqual(["p1", "p5", "p4", "p3", "p2"]);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("orders multiple active players by entryAt asc (defensive for mid-game)", () => {
    const a = makePlayer({
      id: "a",
      uid: "ua",
      entryAt: Timestamp.fromMillis(t0Ms + 200),
    });
    const b = makePlayer({
      id: "b",
      uid: "ub",
      entryAt: Timestamp.fromMillis(t0Ms + 100),
    });
    const c = makePlayer({
      id: "c",
      uid: "uc",
      entryAt: Timestamp.fromMillis(t0Ms + 300),
    });
    const r = resolveRanking([a, b, c]);
    expect(r.map((x) => x.pid)).toEqual(["b", "a", "c"]);
  });

  it("breaks bustedAt-tie by entryAt asc, then by pid asc (deterministic)", () => {
    const sameBust = Timestamp.fromMillis(t0Ms + 5_000);
    const winner = makePlayer({ id: "w", uid: "uw" });
    const p2 = makePlayer({
      id: "p2",
      uid: "u2",
      entryAt: Timestamp.fromMillis(t0Ms + 100),
      isBusted: true,
      bustedAt: sameBust,
    });
    const p3 = makePlayer({
      id: "p3",
      uid: "u3",
      entryAt: Timestamp.fromMillis(t0Ms + 100), // 同 entryAt
      isBusted: true,
      bustedAt: sameBust, // 同 ms バスト
    });
    const p1 = makePlayer({
      id: "p1",
      uid: "u1",
      entryAt: Timestamp.fromMillis(t0Ms + 50), // 早い entryAt
      isBusted: true,
      bustedAt: sameBust, // 同 ms バスト
    });
    const r = resolveRanking([p3, p2, p1, winner]);
    // active winner が rank 1。次にバスト 3 名は entryAt asc: p1(50ms) → p2(100ms) → p3(100ms, pid asc)
    expect(r.map((x) => x.pid)).toEqual(["w", "p1", "p2", "p3"]);
  });

  it("returns deterministic order even with all-busted players (defensive)", () => {
    const ts = Timestamp.fromMillis(t0Ms + 5_000);
    const p1 = makePlayer({ id: "p1", isBusted: true, bustedAt: ts });
    const p2 = makePlayer({ id: "p2", isBusted: true, bustedAt: ts });
    const r = resolveRanking([p2, p1]);
    expect(r.map((x) => x.pid)).toEqual(["p1", "p2"]);
    expect(r.map((x) => x.rank)).toEqual([1, 2]);
  });

  it("preserves uid: null entries (Phase 4 以前互換)", () => {
    const p1 = makePlayer({ id: "p1", uid: null, displayName: "Anonymous" });
    const r = resolveRanking([p1]);
    expect(r[0].uid).toBeNull();
  });
});
