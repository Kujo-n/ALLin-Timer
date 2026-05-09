import { render, screen, waitFor } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

// hooks / firebase module mocks — import 前に宣言する必要がある。
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
  })),
}));
vi.mock("@/lib/hooks/useTournamentTimer", () => ({
  useTournamentTimer: vi.fn(),
}));
vi.mock("@/lib/firebase/repositories/players", () => ({
  subscribePlayers: vi.fn(),
}));
vi.mock("@/lib/firebase/repositories/tables", () => ({
  subscribeTables: vi.fn(),
}));

// /spectate は useAuthUser / useCurrentGroup / receipt / auth-actions を呼ばないため
// mock 不要。これが「auth コンテキスト不読」の機械検証 (negative test)。

import { subscribePlayers } from "@/lib/firebase/repositories/players";
import { subscribeTables } from "@/lib/firebase/repositories/tables";
import { useTournamentTimer } from "@/lib/hooks/useTournamentTimer";

import { SpectateClient } from "./spectate-client";

const ts = Timestamp.fromDate(new Date("2026-05-09T10:00:00Z"));

function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t1",
    groupId: "g1",
    createdByUid: "u1",
    name: "Spectate Tournament",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 3,
      levels: [
        { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
        { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
        { level: 3, sb: 75, bb: 150, ante: 25, durationSec: 600, isBreak: false },
        { level: 4, sb: 100, bb: 200, ante: 25, durationSec: 600, isBreak: false },
      ],
    },
    state: "running",
    startedAt: ts,
    levelStartedAt: ts,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 2,
    lateEntryDeadlineLevel: 3,
    seatsPerTable: 9,
    spectateEnabled: true, // spectate 通常 case の default を true に倒す
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

function setTimerMock(payload: {
  tournament: TournamentDoc | null;
  error?: AppError | null;
}): void {
  vi.mocked(useTournamentTimer).mockReturnValue({
    tournament: payload.tournament,
    remainingMs: payload.tournament ? 300_000 : null,
    fromCache: false,
    hasPendingWrites: false,
    lastSyncAt: payload.tournament ? Date.now() : null,
    error: payload.error ?? null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // subscribePlayers / subscribeTables は default で空リスト + cleanup を返す
  vi.mocked(subscribePlayers).mockImplementation((_tid, onNext) => {
    onNext([]);
    return () => {};
  });
  vi.mocked(subscribeTables).mockImplementation((_tid, onNext) => {
    onNext([]);
    return () => {};
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SpectateClient", () => {
  it("tournament が null のとき『読込中…』を表示する", () => {
    setTimerMock({ tournament: null });
    render(<SpectateClient tid="t1" />);
    expect(screen.getByText("読込中…")).toBeInTheDocument();
  });

  it("spectateEnabled=false のとき『観戦が公開されていません』を表示する", () => {
    setTimerMock({ tournament: makeTournament({ spectateEnabled: false }) });
    render(<SpectateClient tid="t1" />);
    expect(screen.getByText("観戦が公開されていません")).toBeInTheDocument();
  });

  it("spectateEnabled=true / running のときタイマー + late entry banner を表示する", () => {
    setTimerMock({ tournament: makeTournament({ currentLevel: 2 }) });
    render(<SpectateClient tid="t1" />);
    expect(screen.getByText("Spectate Tournament")).toBeInTheDocument();
    // TimerDisplay 内の Lv badge を aria-label で scope する（late-entry banner にも "Lv 2" が出るため）
    const timerSection = screen.getByLabelText("タイマー");
    expect(timerSection).toHaveTextContent(/Lv\s*2/);
    // late entry open banner
    expect(screen.getByTestId("spectate-late-entry-open")).toBeInTheDocument();
  });

  it("currentLevel > lateEntryDeadlineLevel のとき『受付終了』banner を表示する", () => {
    setTimerMock({ tournament: makeTournament({ currentLevel: 4 }) });
    render(<SpectateClient tid="t1" />);
    expect(screen.getByTestId("spectate-late-entry-closed")).toBeInTheDocument();
  });

  it("state=finished のとき『終了しました』banner を表示する", () => {
    setTimerMock({ tournament: makeTournament({ state: "finished" }) });
    render(<SpectateClient tid="t1" />);
    expect(screen.getByText(/終了しました/)).toBeInTheDocument();
  });

  it("subscribePlayers が permission-denied で onError 発火 → 『観戦が終了しました』に遷移する", async () => {
    setTimerMock({ tournament: makeTournament() });
    // subscribePlayers が登録される瞬間に anon 経由で permission-denied を発火させる
    vi.mocked(subscribePlayers).mockImplementation((_tid, _onNext, onError) => {
      // FirebaseError 風（code を持つ object）を AppError でラップして渡す
      const inner = Object.assign(new Error("PERMISSION_DENIED"), {
        code: "permission-denied",
      });
      onError(AppError.from(inner, "firestore/subscribe_failed", "参加者購読エラー"));
      return () => {};
    });
    render(<SpectateClient tid="t1" />);
    await waitFor(() =>
      expect(screen.getByText("観戦が終了しました")).toBeInTheDocument(),
    );
  });

  it("useTournamentTimer の error が permission-denied のとき『観戦が終了しました』に遷移する", async () => {
    const inner = Object.assign(new Error("PERMISSION_DENIED"), {
      code: "permission-denied",
    });
    setTimerMock({
      tournament: null,
      error: AppError.from(inner, "firestore/subscribe_failed", "購読エラー"),
    });
    render(<SpectateClient tid="t1" />);
    await waitFor(() =>
      expect(screen.getByText("観戦が終了しました")).toBeInTheDocument(),
    );
  });

  it("permission-denied 以外の subscribe error は『観戦が終了しました』に遷移しない（『読込中』を維持）", async () => {
    setTimerMock({ tournament: null });
    vi.mocked(subscribePlayers).mockImplementation((_tid, _onNext, onError) => {
      // unavailable 等は spectate-OFF とは無関係なので無視（loading 継続）
      const inner = Object.assign(new Error("UNAVAILABLE"), { code: "unavailable" });
      onError(AppError.from(inner, "firestore/subscribe_failed", "参加者購読エラー"));
      return () => {};
    });
    render(<SpectateClient tid="t1" />);
    // 一定時間待っても spectateEnded に遷移しないことを確認
    expect(screen.getByText("読込中…")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("観戦が終了しました")).not.toBeInTheDocument();
  });
});
