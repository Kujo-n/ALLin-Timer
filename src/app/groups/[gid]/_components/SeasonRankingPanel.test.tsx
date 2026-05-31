import { act, render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { subscribeSeasonStats } from "@/lib/firebase/repositories/seasonStats";
import type { SeasonStatsDoc } from "@/lib/firebase/schemas/seasonStats";

vi.mock("@/lib/firebase/AuthProvider", () => ({
  useAuthUser: () => ({
    user: { uid: "u-self", isAnonymous: false, displayName: "Self" },
    loading: false,
  }),
}));

vi.mock("@/lib/firebase/repositories/seasonStats", () => ({
  subscribeSeasonStats: vi.fn(),
}));

import { SeasonRankingPanel } from "./SeasonRankingPanel";

const fixedTs = Timestamp.fromDate(new Date("2026-05-01T00:00:00Z"));

function makeStat(overrides: Partial<SeasonStatsDoc> = {}): SeasonStatsDoc {
  return {
    id: "u-1",
    uid: "u-1",
    displayName: "Alice",
    participations: 5,
    wins: 2,
    finalTables: 3,
    totalPoints: 47.83,
    lastUpdatedAt: fixedTs,
    ...overrides,
  };
}

/** subscribeSeasonStats の onNext / onError を手動 capture するための型。 */
type Captured = {
  onNext: (items: SeasonStatsDoc[]) => void;
  onError: (err: AppError) => void;
};

let captured: Captured | null;
const unsub = vi.fn();

beforeEach(() => {
  captured = null;
  unsub.mockReset();
  vi.mocked(subscribeSeasonStats).mockReset();
  vi.mocked(subscribeSeasonStats).mockImplementation((_gid, onNext, onError) => {
    captured = { onNext, onError };
    return unsub;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SeasonRankingPanel", () => {
  it("購読発火前は『順位を読込中…』を表示する", () => {
    render(<SeasonRankingPanel gid="g-1" />);
    expect(screen.getByText("順位を読込中…")).toBeInTheDocument();
  });

  it("onNext([]) で空メッセージを表示し table は描画しない", () => {
    render(<SeasonRankingPanel gid="g-1" />);
    act(() => captured!.onNext([]));
    expect(
      screen.getByText(/このシーズンの戦績はまだありません/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("season-ranking-inline")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("onNext([2 件]) で season-ranking-inline と 2 行を描画する", () => {
    render(<SeasonRankingPanel gid="g-1" />);
    act(() =>
      captured!.onNext([
        makeStat({ id: "u-alice", displayName: "Alice" }),
        makeStat({ id: "u-bob", displayName: "Bob" }),
      ]),
    );
    expect(screen.getByTestId("season-ranking-inline")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    // ヘッダ 1 + data 2 = 3 行
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("onError(AppError) で role=alert に code 文字列を表示する", () => {
    render(<SeasonRankingPanel gid="g-1" />);
    act(() =>
      captured!.onError(
        new AppError("購読エラー", "firestore/subscribe_failed"),
      ),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("firestore/subscribe_failed");
  });

  it("unmount で unsubscribe を呼ぶ", () => {
    const { unmount } = render(<SeasonRankingPanel gid="g-1" />);
    expect(unsub).not.toHaveBeenCalled();
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
