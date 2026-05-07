import { render, screen, waitFor } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { getGroup } from "@/lib/firebase/repositories/groups";
import { getSeasonHistory } from "@/lib/firebase/repositories/seasonHistory";
import type { GroupDoc } from "@/lib/firebase/schemas/group";
import type { SeasonHistoryDoc } from "@/lib/firebase/schemas/seasonHistory";

import { SeasonHistoryDetailClient } from "./season-history-detail-client";

vi.mock("@/lib/firebase/repositories/groups", () => ({
  getGroup: vi.fn(),
}));

vi.mock("@/lib/firebase/repositories/seasonHistory", () => ({
  getSeasonHistory: vi.fn(),
}));

vi.mock("@/lib/firebase/AuthProvider", () => ({
  useAuthUser: () => ({ user: { uid: "u-self" } }),
}));

const startTs = Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
const endTs = Timestamp.fromDate(new Date("2026-04-01T00:00:00Z"));
const createdAt = Timestamp.fromDate(new Date("2025-12-01T00:00:00Z"));

function makeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  return {
    id: "g-1",
    name: "サタデーサークル",
    ownerUids: ["u-owner"],
    organizerUids: ["u-owner"],
    memberUids: ["u-owner", "u-self"],
    memberDisplayNames: { "u-self": "Self" },
    audioSettings: {
      enabled: false,
      volume: 0.7,
      levelUpSoundId: "default:blind-up",
      winnerSoundId: "default:victory-chime",
    },
    finishedTournamentCount: 0,
    defaultSeatsPerTable: 8,
    seasonStartDate: null,
    defaultTableLabels: [],
    defaultTableColors: [],
    createdAt,
    joinCodeId: null,
    ...overrides,
  };
}

function makeHistory(
  overrides: Partial<SeasonHistoryDoc> = {},
): SeasonHistoryDoc {
  return {
    id: "season-uuid-1",
    startedAt: startTs,
    endedAt: endTs,
    entries: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getGroup).mockReset();
  vi.mocked(getSeasonHistory).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SeasonHistoryDetailClient", () => {
  it("entries 5 件のとき totalPoints desc で 5 行 table を描画する", async () => {
    vi.mocked(getGroup).mockResolvedValue(makeGroup());
    vi.mocked(getSeasonHistory).mockResolvedValue(
      makeHistory({
        entries: [
          {
            uid: "u-bob",
            displayName: "Bob",
            participations: 10,
            wins: 2,
            finalTables: 4,
            totalPoints: 28.1,
          },
          {
            uid: "u-alice",
            displayName: "Alice",
            participations: 12,
            wins: 4,
            finalTables: 6,
            totalPoints: 35.2,
          },
          {
            uid: "u-eve",
            displayName: "Eve",
            participations: 3,
            wins: 0,
            finalTables: 0,
            totalPoints: 2.1,
          },
          {
            uid: "u-carol",
            displayName: "Carol",
            participations: 8,
            wins: 1,
            finalTables: 3,
            totalPoints: 19.66,
          },
          {
            uid: "u-dave",
            displayName: "Dave",
            participations: 5,
            wins: 0,
            finalTables: 1,
            totalPoints: 6.4,
          },
        ],
      }),
    );

    render(<SeasonHistoryDetailClient gid="g-1" seasonId="season-uuid-1" />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    const rows = document.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(5);
    // totalPoints desc で sort されることを確認（先頭行が Alice、最終行が Eve）
    expect(rows[0].textContent).toContain("Alice");
    expect(rows[0].textContent).toContain("35.20 pt");
    expect(rows[4].textContent).toContain("Eve");

    // download button が出る
    expect(screen.getByTestId("season-top-card-download")).toBeInTheDocument();
    // 戻りリンクが出る
    expect(screen.getByText("現在シーズンへ")).toBeInTheDocument();
    expect(screen.getByText("サークル詳細")).toBeInTheDocument();
  });

  it("entries=[] のとき『記録はありません』を表示し、share / download は出ない", async () => {
    vi.mocked(getGroup).mockResolvedValue(makeGroup());
    vi.mocked(getSeasonHistory).mockResolvedValue(makeHistory({ entries: [] }));

    render(<SeasonHistoryDetailClient gid="g-1" seasonId="season-uuid-1" />);

    await waitFor(() => {
      expect(
        screen.getByText("このシーズンの記録はありません。"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("season-top-card-download"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("past-season-top-card-share"),
    ).not.toBeInTheDocument();
  });

  it("firestore/not-found のとき『見つかりません』UI に倒れる", async () => {
    vi.mocked(getGroup).mockResolvedValue(makeGroup());
    vi.mocked(getSeasonHistory).mockRejectedValue(
      new AppError("missing", "firestore/not-found"),
    );

    render(<SeasonHistoryDetailClient gid="g-1" seasonId="missing" />);

    await waitFor(() => {
      expect(
        screen.getByText("シーズン履歴 — 見つかりません"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("現在シーズンへ戻る")).toBeInTheDocument();
  });

  it("非メンバー (firestore/permission-denied) のとき『見つかりません』UI に倒れる", async () => {
    // 認可情報を leak しないため not-found と同じ UI に倒す
    vi.mocked(getGroup).mockRejectedValue(
      new AppError("perm", "firestore/permission-denied"),
    );
    vi.mocked(getSeasonHistory).mockResolvedValue(makeHistory());

    render(<SeasonHistoryDetailClient gid="g-1" seasonId="season-uuid-1" />);

    await waitFor(() => {
      expect(
        screen.getByText("シーズン履歴 — 見つかりません"),
      ).toBeInTheDocument();
    });
    // raw error code が露出していないこと
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/firestore\/permission-denied/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("現在シーズンへ戻る")).toBeInTheDocument();
  });

  it("一般 fetch failure (firestore/read_failed) のとき role=alert でエラーコードを表示する", async () => {
    vi.mocked(getGroup).mockRejectedValue(
      new AppError("offline", "firestore/read_failed"),
    );
    vi.mocked(getSeasonHistory).mockResolvedValue(makeHistory());

    render(<SeasonHistoryDetailClient gid="g-1" seasonId="season-uuid-1" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("firestore/read_failed");
    expect(screen.getByText("現在シーズンへ戻る")).toBeInTheDocument();
  });
});
