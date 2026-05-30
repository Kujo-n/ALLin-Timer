import { describe, expect, it } from "vitest";

import type { Level } from "@/lib/firebase/schemas/structure";

import {
  applyBulkDurationMin,
  inferBulkDurationMin,
  minToDurationSec,
} from "./structure-levels";

function level(overrides: Partial<Level> = {}): Level {
  return {
    level: 1,
    sb: 25,
    bb: 50,
    ante: 0,
    durationSec: 600,
    isBreak: false,
    ...overrides,
  };
}

describe("minToDurationSec", () => {
  it("通常の分を秒に変換する（10 → 600）", () => {
    expect(minToDurationSec(10)).toBe(600);
  });

  it("0 は下限 60 秒に倒す（durationSec.positive() 適合）", () => {
    expect(minToDurationSec(0)).toBe(60);
  });

  it("負値も下限 60 秒に倒す", () => {
    expect(minToDurationSec(-5)).toBe(60);
  });
});

describe("applyBulkDurationMin", () => {
  it("全行（play + break 混在）の durationSec を一律 minutes*60 に揃える", () => {
    const levels: Level[] = [
      level({ level: 1, durationSec: 600 }),
      level({ level: 2, sb: 50, bb: 100, durationSec: 1200 }),
      level({ level: 3, sb: 0, bb: 0, durationSec: 300, isBreak: true }),
    ];
    const result = applyBulkDurationMin(levels, 15);
    expect(result.map((l) => l.durationSec)).toEqual([900, 900, 900]);
  });

  it("durationSec 以外のフィールド（level / sb / bb / ante / isBreak）は不変", () => {
    const levels: Level[] = [
      level({ level: 1, sb: 25, bb: 50, ante: 5, durationSec: 600 }),
      level({ level: 2, sb: 0, bb: 0, ante: 0, durationSec: 600, isBreak: true }),
    ];
    const result = applyBulkDurationMin(levels, 20);
    expect(result).toEqual([
      { level: 1, sb: 25, bb: 50, ante: 5, durationSec: 1200, isBreak: false },
      { level: 2, sb: 0, bb: 0, ante: 0, durationSec: 1200, isBreak: true },
    ]);
  });

  it("0 分入力でも全行 60 秒に倒す", () => {
    const result = applyBulkDurationMin([level(), level({ level: 2 })], 0);
    expect(result.map((l) => l.durationSec)).toEqual([60, 60]);
  });

  it("入力配列を mutate しない（純関数）", () => {
    const levels = [level({ durationSec: 600 })];
    applyBulkDurationMin(levels, 15);
    expect(levels[0].durationSec).toBe(600);
  });
});

describe("inferBulkDurationMin", () => {
  it("全行が揃った 600 秒なら 10 を返す", () => {
    const levels = [
      level({ level: 1, durationSec: 600 }),
      level({ level: 2, durationSec: 600 }),
    ];
    expect(inferBulkDurationMin(levels)).toBe(10);
  });

  it("空配列なら既定 10 を返す", () => {
    expect(inferBulkDurationMin([])).toBe(10);
  });

  it("不揃いなら先頭行の分（600/1200 秒 → 10）を返す", () => {
    const levels = [
      level({ level: 1, durationSec: 600 }),
      level({ level: 2, durationSec: 1200 }),
    ];
    expect(inferBulkDurationMin(levels)).toBe(10);
  });

  it("先頭行が 900 秒なら 15 を返す", () => {
    expect(inferBulkDurationMin([level({ durationSec: 900 })])).toBe(15);
  });
});
