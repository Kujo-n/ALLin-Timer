/**
 * Phase 4.9 / 要望④: useAudioPlayer のロール filter / レベル終了検知（ローカル残り0）/
 * winner 検知 / unlock state テスト。
 *
 * jsdom には HTMLMediaElement.play / canPlayType の実装がないため Object.defineProperty で stub する。
 */
import { act, renderHook } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// mutable mock context: 各テストで state を切替えることで
// 「初回 mount 時に既に running（SPA 遷移後の再 mount）」のシナリオも検証する。
const { audioContextMock, audioListeners } = vi.hoisted(() => ({
  audioContextMock: { state: "suspended" as AudioContextState },
  audioListeners: new Set<(state: AudioContextState | null) => void>(),
}));

vi.mock("@/lib/audio/audio-context", () => ({
  getOrCreateAudioContext: vi.fn(() => audioContextMock),
  resumeAudioContext: vi.fn(async () => {
    audioContextMock.state = "running";
    audioListeners.forEach((cb) => cb("running"));
    return "running";
  }),
  // useSyncExternalStore 用の購読 / スナップショット API を mock する。
  subscribeAudioContextState: vi.fn((cb: (s: AudioContextState | null) => void) => {
    audioListeners.add(cb);
    return () => {
      audioListeners.delete(cb);
    };
  }),
  readAudioContextState: vi.fn(() => audioContextMock.state),
}));

import type { GroupDoc } from "@/lib/firebase/schemas/group";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

import { useAudioPlayer, type AudioRole } from "./useAudioPlayer";

const baseTimestamp = Timestamp.fromDate(new Date("2026-04-20T10:00:00Z"));
/** 二重再生 / 新レベル切替を区別するための別 levelStartedAt（キー差）。 */
const nextLevelStartedAt = Timestamp.fromMillis(baseTimestamp.toMillis() + 600_000);

const playSpy = vi.fn().mockResolvedValue(undefined);
const pauseSpy = vi.fn();

beforeEach(() => {
  playSpy.mockClear();
  pauseSpy.mockClear();
  // 既定は suspended。SPA 遷移耐性テストのみ "running" にして mount する。
  audioContextMock.state = "suspended";
  audioListeners.clear();
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: playSpy,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: pauseSpy,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
    configurable: true,
    value: vi.fn(() => "probably"),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  return {
    id: "g1",
    name: "Saturday",
    ownerUids: ["u1"],
    organizerUids: ["u1"],
    memberUids: ["u1"],
    memberDisplayNames: {},
    audioSettings: {
      enabled: true,
      levelUpSoundId: "default:blind-up",
      winnerSoundId: "default:victory-chime",
      volume: 0.5,
    },
    finishedTournamentCount: 0,
    defaultSeatsPerTable: 8,
    seasonStartDate: null,
    defaultTableLabels: [],
    defaultTableColors: [],
    seasonPointsRule: null,
    winnerCardBackground: null,
    seasonCardBackground: null,
    latestJoinCodeId: null,
    createdAt: baseTimestamp,
    ...overrides,
  };
}

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
      // 3 レベル: currentLevel 2 を非最終、currentLevel 3 を最終として検証できるようにする。
      levels: [
        { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
        { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
        { level: 3, sb: 75, bb: 150, ante: 25, durationSec: 600, isBreak: false },
      ],
    },
    state: "running",
    startedAt: baseTimestamp,
    levelStartedAt: baseTimestamp,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 1,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    spectateEnabled: false,
    createdAt: baseTimestamp,
    updatedAt: baseTimestamp,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<PlayerDoc> & { id: string; uid: string }): PlayerDoc {
  return {
    displayName: "P",
    entryAt: baseTimestamp,
    isBusted: false,
    bustedAt: null,
    tableNum: null,
    seatNum: null,
    lastMovedAt: null,
    isPlayingDealer: false,
    ...overrides,
  };
}

interface RenderArgs {
  tournament: TournamentDoc | null;
  group: GroupDoc | null;
  players: readonly PlayerDoc[];
  role: AudioRole;
  remainingMs: number | null;
}

function renderAudioPlayer(initial: RenderArgs) {
  return renderHook((args: RenderArgs) => useAudioPlayer(args), { initialProps: initial });
}

describe("useAudioPlayer — level end sound (local remaining 0)", () => {
  it("does not play for member role when remaining reaches 0", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "member",
      remainingMs: 5000,
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "member",
      remainingMs: 0,
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not play for null role (anonymous / non-member)", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: null,
      remainingMs: 5000,
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: null,
      remainingMs: 0,
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("plays for organizer when remaining reaches 0 after unlock", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 5000,
    });
    await act(async () => {
      await result.current.unlock();
    });
    expect(result.current.unlocked).toBe(true);
    // 残りが正の値のあいだは鳴らない
    expect(playSpy).not.toHaveBeenCalled();

    rerender({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 0,
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("plays for owner when remaining reaches 0", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "owner",
      remainingMs: 5000,
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "owner",
      remainingMs: 0,
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("does not play if audioSettings.enabled is false", async () => {
    const disabled = makeGroup({
      audioSettings: {
        enabled: false,
        levelUpSoundId: "default:blind-up",
        winnerSoundId: "default:victory-chime",
        volume: 0.5,
      },
    });
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: disabled,
      players: [],
      role: "owner",
      remainingMs: 5000,
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 1 }),
      group: disabled,
      players: [],
      role: "owner",
      remainingMs: 0,
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not play before unlock even for organizer", () => {
    const { rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 5000,
    });
    rerender({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 0,
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not play on a transition that never reaches remaining 0 (manual advance)", async () => {
    // 「前レベル / 次レベル」ボタン経由（手動）の遷移は残り 0 を経由しない。
    // currentLevel が 1→2 に変わっても remaining が正のままなら鳴らさない（旧 lastLevelChangeKind
    // == "manual" 抑止の置換テスト。手動遷移は自然に無音になる）。
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 4000,
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 2, levelStartedAt: nextLevelStartedAt }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 4000,
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not play on initial mount while remaining > 0", async () => {
    const { result } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 5000,
    });
    await act(async () => {
      await result.current.unlock();
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not re-play while remaining stays 0 across ticks (same levelStartedAt)", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 5000,
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 0,
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
    // 同じ levelStartedAt のまま次 tick でも remaining 0 → 二重再生しない
    rerender({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 0,
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("plays again for the next level (different levelStartedAt) when remaining reaches 0", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 5000,
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 0,
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
    // 次レベルへ（levelStartedAt が変わる）→ 再び残り 0 で 1 回鳴る
    rerender({
      tournament: makeTournament({ currentLevel: 2, levelStartedAt: nextLevelStartedAt }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 0,
    });
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  it("does not play on the final level even when remaining reaches 0", async () => {
    // currentLevel 3 === levels.length（最終）。次レベルが無いため「ブラインドアップ」ではない。
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 3, levelStartedAt: nextLevelStartedAt }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 5000,
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 3, levelStartedAt: nextLevelStartedAt }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 0,
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not play when state is setup even if remaining is 0", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ state: "setup", currentLevel: 0, levelStartedAt: null }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: null,
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ state: "setup", currentLevel: 0, levelStartedAt: null }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 0,
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not play on seating → running transition (remaining full > 0 at start)", async () => {
    // seating → running（confirmSeating で currentLevel 0→1）は「トーナメント開始」であり、
    // 開始直後は残り full（> 0）のため shouldPlayLevelEndSound が false を返し自然に無音になる。
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ state: "seating", currentLevel: 0, levelStartedAt: null }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: null,
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ state: "running", currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 600_000,
    });
    expect(playSpy).not.toHaveBeenCalled();
  });
});

describe("useAudioPlayer — winner detection", () => {
  it("plays once on null → PlayerDoc transition", async () => {
    const initialPlayers = [
      makePlayer({ id: "p1", uid: "u1" }),
      makePlayer({ id: "p2", uid: "u2" }),
    ];
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ state: "running" }),
      group: makeGroup(),
      players: initialPlayers,
      role: "organizer",
      remainingMs: null,
    });
    await act(async () => {
      await result.current.unlock();
    });
    expect(playSpy).not.toHaveBeenCalled();

    // p2 が脱落して winner 確定
    rerender({
      tournament: makeTournament({ state: "running" }),
      group: makeGroup(),
      players: [
        makePlayer({ id: "p1", uid: "u1" }),
        makePlayer({ id: "p2", uid: "u2", isBusted: true, bustedAt: baseTimestamp }),
      ],
      role: "organizer",
      remainingMs: null,
    });
    expect(playSpy).toHaveBeenCalledTimes(1);

    // 同じ winner で再 emit しても再生しない
    rerender({
      tournament: makeTournament({ state: "running" }),
      group: makeGroup(),
      players: [
        makePlayer({ id: "p1", uid: "u1" }),
        makePlayer({ id: "p2", uid: "u2", isBusted: true, bustedAt: baseTimestamp }),
      ],
      role: "organizer",
      remainingMs: null,
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("does not play winner sound when mounting a finished tournament", async () => {
    const { result } = renderAudioPlayer({
      tournament: makeTournament({ state: "finished", finishedAt: baseTimestamp }),
      group: makeGroup(),
      players: [
        makePlayer({ id: "p1", uid: "u1" }),
        makePlayer({ id: "p2", uid: "u2", isBusted: true, bustedAt: baseTimestamp }),
      ],
      role: "organizer",
      remainingMs: null,
    });
    await act(async () => {
      await result.current.unlock();
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not play winner sound on null → winner transition while finished", async () => {
    const { result, rerender } = renderAudioPlayer({
      // 全員 active のあいだ resolveWinner は null を返す。
      tournament: makeTournament({ state: "finished", finishedAt: baseTimestamp }),
      group: makeGroup(),
      players: [
        makePlayer({ id: "p1", uid: "u1" }),
        makePlayer({ id: "p2", uid: "u2" }),
      ],
      role: "organizer",
      remainingMs: null,
    });
    await act(async () => {
      await result.current.unlock();
    });
    expect(playSpy).not.toHaveBeenCalled();

    // finished 中に winner 確定（p2 脱落）→ finished ガードで鳴らない
    rerender({
      tournament: makeTournament({ state: "finished", finishedAt: baseTimestamp }),
      group: makeGroup(),
      players: [
        makePlayer({ id: "p1", uid: "u1" }),
        makePlayer({ id: "p2", uid: "u2", isBusted: true, bustedAt: baseTimestamp }),
      ],
      role: "organizer",
      remainingMs: null,
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not play winner sound for member", async () => {
    const initialPlayers = [
      makePlayer({ id: "p1", uid: "u1" }),
      makePlayer({ id: "p2", uid: "u2" }),
    ];
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ state: "running" }),
      group: makeGroup(),
      players: initialPlayers,
      role: "member",
      remainingMs: null,
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ state: "running" }),
      group: makeGroup(),
      players: [
        makePlayer({ id: "p1", uid: "u1" }),
        makePlayer({ id: "p2", uid: "u2", isBusted: true, bustedAt: baseTimestamp }),
      ],
      role: "member",
      remainingMs: null,
    });
    expect(playSpy).not.toHaveBeenCalled();
  });
});

describe("useAudioPlayer — unlock state", () => {
  it("flips unlocked to true after unlock() resolves", async () => {
    const { result } = renderAudioPlayer({
      tournament: null,
      group: makeGroup(),
      players: [],
      role: "owner",
      remainingMs: null,
    });
    expect(result.current.unlocked).toBe(false);
    await act(async () => {
      await result.current.unlock();
    });
    expect(result.current.unlocked).toBe(true);
  });

  // Phase 4.9 追加修正: SPA 内ページ遷移後の再 mount 時、AudioContext singleton が
  // 既に running 状態ならユーザー操作を改めて要求しない。
  it("initializes unlocked=true on mount if AudioContext is already running", () => {
    audioContextMock.state = "running";
    const { result } = renderAudioPlayer({
      tournament: null,
      group: makeGroup(),
      players: [],
      role: "owner",
      remainingMs: null,
    });
    expect(result.current.unlocked).toBe(true);
  });

  it("initializes unlocked=false on mount if AudioContext is suspended", () => {
    audioContextMock.state = "suspended";
    const { result } = renderAudioPlayer({
      tournament: null,
      group: makeGroup(),
      players: [],
      role: "owner",
      remainingMs: null,
    });
    expect(result.current.unlocked).toBe(false);
  });
});

describe("useAudioPlayer — preview()", () => {
  it("plays for organizer (unlocking implicitly)", async () => {
    const { result } = renderAudioPlayer({
      tournament: null,
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: null,
    });
    await act(async () => {
      await result.current.preview("default:blind-up");
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(result.current.unlocked).toBe(true);
  });

  it("does not play for member role", async () => {
    const { result } = renderAudioPlayer({
      tournament: null,
      group: makeGroup(),
      players: [],
      role: "member",
      remainingMs: null,
    });
    await act(async () => {
      await result.current.preview("default:blind-up");
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not play if audioSettings.enabled is false", async () => {
    const disabled = makeGroup({
      audioSettings: {
        enabled: false,
        levelUpSoundId: "default:blind-up",
        winnerSoundId: "default:victory-chime",
        volume: 0.5,
      },
    });
    const { result } = renderAudioPlayer({
      tournament: null,
      group: disabled,
      players: [],
      role: "owner",
      remainingMs: null,
    });
    await act(async () => {
      await result.current.preview("default:blind-up");
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not invoke play when canPlayType returns empty for all sources", async () => {
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: vi.fn(() => ""),
    });
    const { result } = renderAudioPlayer({
      tournament: null,
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: null,
    });
    await act(async () => {
      await result.current.preview("default:blind-up");
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("swallows play() rejection without throwing", async () => {
    playSpy.mockRejectedValueOnce(new Error("AbortError"));
    const { result } = renderAudioPlayer({
      tournament: null,
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: null,
    });
    await act(async () => {
      await result.current.preview("default:blind-up");
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
    // 例外は throw されず logger.warn に流れる（エラー時 unlocked は変わらない）
    expect(result.current.unlocked).toBe(true);
  });

  it("falls back to default sound for unknown soundId", async () => {
    const { result } = renderAudioPlayer({
      tournament: null,
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: null,
    });
    await act(async () => {
      await result.current.preview("custom:nonexistent");
    });
    // resolveSound のフォールバックで再生される（catalog 既定の先頭）
    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});

describe("useAudioPlayer — play() error path", () => {
  it("swallows play() rejection on level end without throwing", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 5000,
    });
    await act(async () => {
      await result.current.unlock();
    });
    playSpy.mockRejectedValueOnce(new Error("AbortError"));
    rerender({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 0,
    });
    // play は呼ばれるが reject — hook 側で warn されて throw しない
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("does not invoke play when canPlayType returns empty for all sources on level end", async () => {
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: vi.fn(() => ""),
    });
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 5000,
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 0,
    });
    expect(playSpy).not.toHaveBeenCalled();
  });
});

describe("useAudioPlayer — pause on enabled flip", () => {
  // Phase 4.14: ユーザー報告。「OFF をクリック → アイコンは ☓ に変わるが、直前の
  // レベルアップ音が最後まで鳴り続ける」という UI / 音の不整合を防ぐ。
  // gate（play() 内の early return）は新規再生をブロックするだけで、既に走っている
  // <audio> 要素を停止しないため、enabled が false に変わったタイミングで明示的に
  // pause を呼ぶ effect が必要。
  it("pauses the in-flight audio when enabled flips from true to false", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 5000,
    });
    await act(async () => {
      await result.current.unlock();
    });
    // レベル終了で再生開始（<audio> 要素生成 + play()）
    rerender({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
      remainingMs: 0,
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
    pauseSpy.mockClear();

    // group.audioSettings.enabled が false に切替わる
    const disabled = makeGroup({
      audioSettings: {
        enabled: false,
        levelUpSoundId: "default:blind-up",
        winnerSoundId: "default:victory-chime",
        volume: 0.5,
      },
    });
    rerender({
      tournament: makeTournament({ currentLevel: 1 }),
      group: disabled,
      players: [],
      role: "organizer",
      remainingMs: 0,
    });
    // 既に再生中の <audio> は明示的に pause されること
    expect(pauseSpy).toHaveBeenCalled();
  });

  it("does not pause when enabled is already false on initial mount", () => {
    const disabled = makeGroup({
      audioSettings: {
        enabled: false,
        levelUpSoundId: "default:blind-up",
        winnerSoundId: "default:victory-chime",
        volume: 0.5,
      },
    });
    pauseSpy.mockClear();
    renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: disabled,
      players: [],
      role: "organizer",
      remainingMs: 5000,
    });
    // <audio> 要素自体生成されていないため pause は呼ばれない（audioElRef.current === null）
    expect(pauseSpy).not.toHaveBeenCalled();
  });
});
