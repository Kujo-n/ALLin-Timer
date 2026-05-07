import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { listSeasonHistory } from "@/lib/firebase/repositories/seasonHistory";
import type { SeasonHistoryDoc } from "@/lib/firebase/schemas/seasonHistory";

import { SeasonHistoryList } from "./SeasonHistoryList";

vi.mock("@/lib/firebase/repositories/seasonHistory", () => ({
  listSeasonHistory: vi.fn(),
}));

const startTs = Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
const endTs = Timestamp.fromDate(new Date("2026-04-01T00:00:00Z"));
const olderEnd = Timestamp.fromDate(new Date("2025-12-01T00:00:00Z"));

function makeHistory(
  overrides: Partial<SeasonHistoryDoc> = {},
): SeasonHistoryDoc {
  return {
    id: "season-1",
    startedAt: startTs,
    endedAt: endTs,
    entries: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(listSeasonHistory).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SeasonHistoryList", () => {
  it("履歴 0 件のときセクションごと render しない", async () => {
    vi.mocked(listSeasonHistory).mockResolvedValue([]);
    const { container } = render(<SeasonHistoryList gid="g-1" />);
    await waitFor(() => {
      expect(
        screen.queryByText("過去シーズンを読込中…"),
      ).not.toBeInTheDocument();
    });
    expect(container.querySelector('[data-testid="season-history-section"]')).toBeNull();
  });

  it("履歴 1 件 / entries=[] のときは『戦績なし』表示", async () => {
    vi.mocked(listSeasonHistory).mockResolvedValue([
      makeHistory({ id: "s1", entries: [] }),
    ]);
    render(<SeasonHistoryList gid="g-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("season-history-section")).toBeInTheDocument();
    });
    expect(screen.getByText(/戦績なし/)).toBeInTheDocument();
  });

  it("履歴 1 件 / entries=3 件 のとき首位を表示し、展開で top3 を出す", async () => {
    vi.mocked(listSeasonHistory).mockResolvedValue([
      makeHistory({
        id: "s1",
        entries: [
          {
            uid: "u-bob",
            displayName: "Bob",
            participations: 3,
            wins: 1,
            finalTables: 2,
            totalPoints: 28.12,
          },
          {
            uid: "u-alice",
            displayName: "Alice",
            participations: 5,
            wins: 2,
            finalTables: 3,
            totalPoints: 47.83,
          },
          {
            uid: "u-carol",
            displayName: "Carol",
            participations: 2,
            wins: 0,
            finalTables: 1,
            totalPoints: 19.66,
          },
        ],
      }),
    ]);
    render(<SeasonHistoryList gid="g-1" />);
    await waitFor(() => {
      // 首位は totalPoints 最大の Alice
      expect(screen.getByText(/首位: Alice 47\.83 pt/)).toBeInTheDocument();
    });
    // 折り畳み中は top3 詳細が出ない
    expect(screen.queryByText(/Bob — 28\.12 pt/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("season-history-toggle-s1"));
    expect(await screen.findByText(/Alice — 47\.83 pt/)).toBeInTheDocument();
    expect(screen.getByText(/Bob — 28\.12 pt/)).toBeInTheDocument();
    expect(screen.getByText(/Carol — 19\.66 pt/)).toBeInTheDocument();
  });

  it("fetch 失敗時は role=alert でエラーメッセージを出す", async () => {
    vi.mocked(listSeasonHistory).mockRejectedValue(
      new AppError("perm denied", "firestore/read_failed"),
    );
    render(<SeasonHistoryList gid="g-1" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("firestore/read_failed");
  });

  it("複数件のとき repository が返した順序（endedAt desc）を維持して描画", async () => {
    vi.mocked(listSeasonHistory).mockResolvedValue([
      makeHistory({ id: "newer", endedAt: endTs }),
      makeHistory({ id: "older", endedAt: olderEnd, startedAt: null }),
    ]);
    render(<SeasonHistoryList gid="g-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("season-history-item-newer")).toBeInTheDocument();
    });
    const items = Array.from(
      document.querySelectorAll('[data-testid^="season-history-item-"]'),
    );
    expect(items.map((el) => el.getAttribute("data-testid"))).toEqual([
      "season-history-item-newer",
      "season-history-item-older",
    ]);
    // startedAt null は「未設定」表示
    expect(screen.getByText(/未設定 〜/)).toBeInTheDocument();
  });
});
