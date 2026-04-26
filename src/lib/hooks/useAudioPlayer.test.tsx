/**
 * Phase 4.9: useAudioPlayer のロール filter / level 変化検知 / winner 検知 / unlock state テスト。
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
      levels: [
        { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
        { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
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
    ...overrides,
  };
}

interface RenderArgs {
  tournament: TournamentDoc | null;
  group: GroupDoc | null;
  players: readonly PlayerDoc[];
  role: AudioRole;
}

function renderAudioPlayer(initial: RenderArgs) {
  return renderHook((args: RenderArgs) => useAudioPlayer(args), { initialProps: initial });
}

describe("useAudioPlayer — role filter", () => {
  it("does not play for member role on level change", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "member",
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 2 }),
      group: makeGroup(),
      players: [],
      role: "member",
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not play for null role (anonymous / non-member)", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: null,
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 2 }),
      group: makeGroup(),
      players: [],
      role: null,
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("plays for organizer on level change after unlock", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    await act(async () => {
      await result.current.unlock();
    });
    expect(result.current.unlocked).toBe(true);
    // 初回 mount は鳴らない（前回値 ref 初期化のみ）
    expect(playSpy).not.toHaveBeenCalled();

    rerender({
      tournament: makeTournament({ currentLevel: 2 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("plays for owner on level change", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "owner",
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 2 }),
      group: makeGroup(),
      players: [],
      role: "owner",
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
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 2 }),
      group: disabled,
      players: [],
      role: "owner",
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not play before unlock even for organizer", () => {
    const { rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    rerender({
      tournament: makeTournament({ currentLevel: 2 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not play on level change when lastLevelChangeKind is 'manual'", async () => {
    // 「前レベル / 次レベル」ボタン経由（手動）のときは音を鳴らさない仕様。
    // auto-advance（タイマー満了）のみ鳴らす。
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 2, lastLevelChangeKind: "manual" }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("plays on level change when lastLevelChangeKind is 'auto'", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 2, lastLevelChangeKind: "auto" }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("does not play on initial mount with currentLevel === 1", async () => {
    const { result } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    await act(async () => {
      await result.current.unlock();
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not re-play if currentLevel emits same value", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 2 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
    rerender({
      tournament: makeTournament({ currentLevel: 2 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("does not play on level change when state is setup", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ state: "setup", currentLevel: 0 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ state: "setup", currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not play on seating → running transition (currentLevel 0 → 1 is tournament start)", async () => {
    // confirmSeating は schema コメントどおり lastLevelChangeKind を undefined のまま残すため、
    // hook 側で prev === 0 をトーナメント開始として無視しないと
    // 運営者にブラインドアップ音が誤発火する（M2 回帰テスト）。
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ state: "seating", currentLevel: 0 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ state: "running", currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
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
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
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
    });
    await act(async () => {
      await result.current.preview("custom:nonexistent");
    });
    // resolveSound のフォールバックで再生される（catalog 既定の先頭）
    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});

describe("useAudioPlayer — play() error path", () => {
  it("swallows play() rejection on level change without throwing", async () => {
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    await act(async () => {
      await result.current.unlock();
    });
    playSpy.mockRejectedValueOnce(new Error("AbortError"));
    rerender({
      tournament: makeTournament({ currentLevel: 2 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    // play は呼ばれるが reject — hook 側で warn されて throw しない
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("does not invoke play when canPlayType returns empty for all sources on level change", async () => {
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: vi.fn(() => ""),
    });
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ currentLevel: 1 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
    });
    await act(async () => {
      await result.current.unlock();
    });
    rerender({
      tournament: makeTournament({ currentLevel: 2 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
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
    });
    await act(async () => {
      await result.current.unlock();
    });
    // レベルアップで再生開始（<audio> 要素生成 + play()）
    rerender({
      tournament: makeTournament({ currentLevel: 2 }),
      group: makeGroup(),
      players: [],
      role: "organizer",
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
      tournament: makeTournament({ currentLevel: 2 }),
      group: disabled,
      players: [],
      role: "organizer",
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
    });
    // <audio> 要素自体生成されていないため pause は呼ばれない（audioElRef.current === null）
    expect(pauseSpy).not.toHaveBeenCalled();
  });
});
