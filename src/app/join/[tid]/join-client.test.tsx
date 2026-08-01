import { act, fireEvent, render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupDoc } from "@/lib/firebase/schemas/group";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import type { ReceiptOutcome } from "@/lib/services/receipt";

// join-client は AccountLinkRequired（Google 連携分岐）だけを auth-actions から使う。
// 実体は firebase client / repositories を module scope で辿るため、helper 境界で mock する。
vi.mock("@/lib/services/auth-actions", () => ({
  AccountLinkRequired: class AccountLinkRequired extends Error {},
}));
vi.mock("@/lib/firebase/AuthProvider", () => ({
  useAuthUser: vi.fn(),
}));
vi.mock("@/lib/firebase/repositories/tournaments", () => ({
  getTournament: vi.fn(),
}));
vi.mock("@/lib/services/receipt", () => ({
  joinAsCurrentUser: vi.fn(),
  joinAsExistingUser: vi.fn(),
  joinAsGuest: vi.fn(),
  joinAsNewUser: vi.fn(),
  joinViaGoogle: vi.fn(),
  cancelOwnEntry: vi.fn(),
  // instanceof 判定に使うため、AccountLinkRequired と同じく軽量な実クラスを置く。
  EntryFailedAfterRegister: class EntryFailedAfterRegister extends Error {},
}));
vi.mock("@/lib/services/current-group", () => ({
  useCurrentGroup: vi.fn(),
}));
// LinkAccountDialog は firebase auth を import するため軽量 stub にする。
vi.mock("@/components/auth/LinkAccountDialog", () => ({
  LinkAccountDialog: () => null,
}));

import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { getTournament } from "@/lib/firebase/repositories/tournaments";
import { useCurrentGroup } from "@/lib/services/current-group";
import {
  EntryFailedAfterRegister,
  joinAsCurrentUser,
  joinAsExistingUser,
  joinAsGuest,
  joinAsNewUser,
} from "@/lib/services/receipt";

import { JoinClient } from "./join-client";

const now = Timestamp.fromDate(new Date("2026-07-31T00:00:00Z"));

function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t1",
    groupId: "g1",
    createdByUid: "owner",
    name: "Monthly",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [{ level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false }],
    },
    state: "setup",
    startedAt: null,
    levelStartedAt: null,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 0,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    spectateEnabled: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  const ownerUids = overrides.ownerUids ?? ["u-owner"];
  const organizerUids = overrides.organizerUids ?? [...ownerUids];
  const memberUids = overrides.memberUids ?? [...organizerUids];
  return {
    id: "g1",
    name: "土曜サークル",
    ownerUids,
    organizerUids,
    memberUids,
    memberDisplayNames: {},
    audioSettings: {
      enabled: true,
      levelUpSoundId: "default:blind-up",
      winnerSoundId: "default:victory-chime",
      volume: 0.7,
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
    joinedViaTournamentId: null,
    createdAt: now,
    ...overrides,
  };
}

const setCurrentGroupId = vi.fn();
const refreshGroups = vi.fn().mockResolvedValue(undefined);

function mockGroupContext(groups: GroupDoc[]) {
  vi.mocked(useCurrentGroup).mockReturnValue({
    loading: false,
    groupIds: groups.map((g) => g.id),
    groups,
    currentGroupId: groups[0]?.id ?? null,
    setCurrentGroupId,
    refreshGroups,
    currentGroupRole: "member",
    isOrganizer: false,
    isOwner: false,
  });
}

/** サインイン済み（非匿名）のユーザーで「このアカウントで受付」を押す。 */
async function receiveWithSignedInAccount(outcome: ReceiptOutcome) {
  vi.mocked(joinAsCurrentUser).mockResolvedValue(outcome);
  render(<JoinClient tid="t1" />);
  const button = screen.getByRole("button", { name: "このアカウントで受付" });
  await act(async () => {
    fireEvent.click(button);
  });
}

/** 非匿名でサインイン済みのユーザー。認証確定後の再 render を再現するのに使う。 */
function signedInUser() {
  return {
    uid: "u1",
    displayName: "Alice",
    email: "alice@example.com",
    isAnonymous: false,
  } as unknown as ReturnType<typeof useAuthUser>["user"];
}

function mockAuthUser(user: ReturnType<typeof useAuthUser>["user"]) {
  vi.mocked(useAuthUser).mockReturnValue({ user, loading: false, refreshUser: vi.fn() });
}

/** 未サインイン端末で「新規登録」タブを開き、3 項目を埋めて送信する。 */
async function submitRegisterTab(input: { displayName: string; email: string; password: string }) {
  const view = render(<JoinClient tid="t1" />);
  fireEvent.click(screen.getByRole("tab", { name: "新規登録" }));
  fireEvent.change(screen.getByLabelText("表示名"), {
    target: { value: input.displayName },
  });
  fireEvent.change(screen.getByLabelText("メールアドレス"), {
    target: { value: input.email },
  });
  fireEvent.change(screen.getByLabelText("パスワード"), {
    target: { value: input.password },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "登録して受付" }));
  });
  return view;
}

beforeEach(() => {
  vi.mocked(useAuthUser).mockReturnValue({
    user: {
      uid: "u1",
      displayName: "Alice",
      email: "alice@example.com",
      isAnonymous: false,
    } as unknown as ReturnType<typeof useAuthUser>["user"],
    loading: false,
    refreshUser: vi.fn(),
  });
  vi.mocked(getTournament).mockReset().mockResolvedValue(makeTournament());
  vi.mocked(joinAsCurrentUser).mockReset();
  vi.mocked(joinAsNewUser).mockReset();
  vi.mocked(joinAsGuest).mockReset();
  vi.mocked(joinAsExistingUser).mockReset();
  setCurrentGroupId.mockReset();
  refreshGroups.mockReset().mockResolvedValue(undefined);
  mockGroupContext([makeGroup()]);
});

describe("JoinClient — 自動所属フィードバック（08 Phase 2）", () => {
  it("joined のときサークル名入りのメッセージを出し、group コンテキストを更新する", async () => {
    await receiveWithSignedInAccount({
      result: "created",
      autoJoin: { gid: "g1", status: "joined" },
    });

    expect(await screen.findByText("受付完了")).toBeInTheDocument();
    expect(screen.getByText("土曜サークル のメンバーになりました。")).toBeInTheDocument();
    expect(setCurrentGroupId).toHaveBeenCalledWith("g1");
    expect(refreshGroups).toHaveBeenCalledTimes(1);
  });

  it("group 名が解決できないときは汎用文言に fallback する", async () => {
    mockGroupContext([makeGroup({ id: "g-other", name: "別サークル" })]);

    await receiveWithSignedInAccount({
      result: "created",
      autoJoin: { gid: "g1", status: "joined" },
    });

    expect(await screen.findByText("受付完了")).toBeInTheDocument();
    expect(screen.getByText("サークルのメンバーになりました。")).toBeInTheDocument();
  });

  it("failed のとき受付は成功のまま、控えめな再試行注記を出す", async () => {
    await receiveWithSignedInAccount({
      result: "created",
      autoJoin: { gid: "g1", status: "failed" },
    });

    expect(await screen.findByText("受付完了")).toBeInTheDocument();
    expect(
      screen.getByText("サークルへの登録は完了していません。次回の受付時に自動で再試行されます。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/メンバーになりました/)).toBeNull();
    expect(setCurrentGroupId).not.toHaveBeenCalled();
  });

  it("already-member では所属メッセージを出さないが refreshGroups はする", async () => {
    await receiveWithSignedInAccount({
      result: "already-joined",
      autoJoin: { gid: "g1", status: "already-member" },
    });

    expect(await screen.findByText("既に参加済みです")).toBeInTheDocument();
    expect(screen.queryByText(/メンバーになりました/)).toBeNull();
    expect(setCurrentGroupId).not.toHaveBeenCalled();
    expect(refreshGroups).toHaveBeenCalledTimes(1);
  });

  it("skipped-anonymous では所属メッセージを出さず group コンテキストも触らない", async () => {
    // `/join/[tid]` の現行 UI では非匿名ガードで到達しないが、`joinAsCurrentUser` は
    // `/live` の「参加する」から匿名でも呼ばれ得る型のため契約として固定する。
    await receiveWithSignedInAccount({
      result: "created",
      autoJoin: { gid: "g1", status: "skipped-anonymous" },
    });

    expect(await screen.findByText("受付完了")).toBeInTheDocument();
    expect(screen.queryByText(/メンバーになりました/)).toBeNull();
    expect(screen.queryByText(/再試行されます/)).toBeNull();
    expect(setCurrentGroupId).not.toHaveBeenCalled();
    expect(refreshGroups).not.toHaveBeenCalled();
  });

  it("autoJoin が null（ゲスト相当）なら所属メッセージも失敗注記も出さない", async () => {
    await receiveWithSignedInAccount({ result: "created", autoJoin: null });

    expect(await screen.findByText("受付完了")).toBeInTheDocument();
    expect(screen.queryByText(/メンバーになりました/)).toBeNull();
    expect(screen.queryByText(/再試行されます/)).toBeNull();
    expect(refreshGroups).not.toHaveBeenCalled();
  });
});

describe("JoinClient — 新規登録タブ（08 Phase 3）", () => {
  beforeEach(() => {
    // 受付 QR を読んだ未サインイン端末を想定する（新規登録タブの本来の利用者）。
    vi.mocked(useAuthUser).mockReturnValue({
      user: null,
      loading: false,
      refreshUser: vi.fn(),
    });
  });

  it("タブは ゲスト / ログイン / 新規登録 の 3 つで、既定選択は ゲストのまま", () => {
    render(<JoinClient tid="t1" />);

    const guestTab = screen.getByRole("tab", { name: "ゲスト" });
    expect(guestTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "ログイン" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "新規登録" })).toHaveAttribute("aria-selected", "false");
  });

  it("送信すると joinAsNewUser を呼び、所属メッセージ付きの受付完了になる", async () => {
    vi.mocked(joinAsNewUser).mockResolvedValue({
      result: "created",
      autoJoin: { gid: "g1", status: "joined" },
    });

    await submitRegisterTab({
      displayName: "Alice",
      email: "alice@example.com",
      password: "pass123456",
    });

    expect(joinAsNewUser).toHaveBeenCalledTimes(1);
    expect(joinAsNewUser).toHaveBeenCalledWith({
      tid: "t1",
      email: "alice@example.com",
      password: "pass123456",
      displayName: "Alice",
    });
    expect(await screen.findByText("受付完了")).toBeInTheDocument();
    expect(screen.getByText("土曜サークル のメンバーになりました。")).toBeInTheDocument();
    expect(setCurrentGroupId).toHaveBeenCalledWith("g1");
  });

  it("表示名が 15 字超なら送信前に弾き、アカウントを作らない", async () => {
    await submitRegisterTab({
      displayName: "あ".repeat(16),
      email: "alice@example.com",
      password: "pass123456",
    });

    expect(joinAsNewUser).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("validation/join");
    expect(screen.queryByText("受付完了")).toBeNull();
  });

  it("既登録メールなら「ログイン」タブへ誘導し、完了画面へ遷移しない", async () => {
    vi.mocked(joinAsNewUser).mockRejectedValue(
      new AppError("新規登録に失敗しました", "auth/already-exists"),
    );

    await submitRegisterTab({
      displayName: "Alice",
      email: "alice@example.com",
      password: "pass123456",
    });

    expect(
      screen.getByText(
        "このメールアドレスは既に登録されています。「ログイン」タブから受付してください。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("受付完了")).toBeNull();
  });

  it("想定外のエラーは通常のエラー表示のみで、アカウント作成済みの案内は出さない", async () => {
    // EntryFailedAfterRegister でも auth/already-exists でもない経路（弱いパスワード等）。
    // ここで「アカウントは作成済み」と案内すると、存在しないアカウントでの
    // ログイン再試行へユーザーを誘導してしまう。
    vi.mocked(joinAsNewUser).mockRejectedValue(
      new AppError("パスワードが短すぎます", "auth/weak-password"),
    );

    await submitRegisterTab({
      displayName: "Alice",
      email: "alice@example.com",
      password: "123",
    });

    expect(screen.getByRole("alert")).toHaveTextContent("auth/weak-password");
    expect(screen.queryByText(/アカウントの作成は完了しています/)).toBeNull();
    expect(screen.queryByText("受付完了")).toBeNull();
  });

  it("アカウント作成後に受付が失敗したら、アカウントが残っている旨と復旧手順を案内する", async () => {
    vi.mocked(joinAsNewUser).mockRejectedValue(
      new EntryFailedAfterRegister(
        new AppError("レイトエントリー期限を過ぎています", "tournament/late-entry-closed"),
      ),
    );

    await submitRegisterTab({
      displayName: "Alice",
      email: "alice@example.com",
      password: "pass123456",
    });

    expect(screen.getByText(/アカウントの作成は完了しています/)).toBeInTheDocument();
    expect(screen.queryByText("受付完了")).toBeNull();
  });

  it("復旧案内は同じタブで送信し直すたびにリセットされる", async () => {
    vi.mocked(joinAsNewUser).mockRejectedValueOnce(
      new EntryFailedAfterRegister(
        new AppError("レイトエントリー期限を過ぎています", "tournament/late-entry-closed"),
      ),
    );
    await submitRegisterTab({
      displayName: "Alice",
      email: "alice@example.com",
      password: "pass123456",
    });
    expect(screen.getByText(/アカウントの作成は完了しています/)).toBeInTheDocument();

    // 2 回目は別の失敗（既登録メール）→ 前回の案内が残らない
    vi.mocked(joinAsNewUser).mockRejectedValue(
      new AppError("新規登録に失敗しました", "auth/already-exists"),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "登録して受付" }));
    });

    expect(screen.queryByText(/アカウントの作成は完了しています/)).toBeNull();
  });
});

describe("JoinClient — タブ表示条件（08 Phase 3 レビュー M-1 / M-4）", () => {
  it("サインイン済み（非匿名）ではログイン / 新規登録タブを畳み、ログアウト導線を案内する", async () => {
    // file 冒頭の beforeEach が非匿名サインイン済みユーザーを返す。
    // user が居ると tournament 取得 effect が走るため、解決まで待ってから assert する。
    await act(async () => {
      render(<JoinClient tid="t1" />);
    });

    expect(screen.getByRole("tab", { name: "ゲスト" })).toBeInTheDocument();
    // どちらも現在のセッションを差し替えるため、「このアカウントで受付」と衝突させない。
    expect(screen.queryByRole("tab", { name: "ログイン" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "新規登録" })).toBeNull();
    expect(
      screen.getByText("別のアカウントで受付する場合は、先にログアウトしてください。"),
    ).toBeInTheDocument();
  });

  it("未サインインでは 3 タブすべて出し、二重登録の警告は出さない", () => {
    vi.mocked(useAuthUser).mockReturnValue({
      user: null,
      loading: false,
      refreshUser: vi.fn(),
    });

    render(<JoinClient tid="t1" />);

    expect(screen.getByRole("tab", { name: "ゲスト" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "ログイン" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新規登録" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "新規登録" }));
    expect(screen.queryByText(/別の参加者として受付されます/)).toBeNull();
  });

  it("匿名ゲストではタブを残しつつ、ログイン / 新規登録で二重登録になる旨を警告する", async () => {
    vi.mocked(useAuthUser).mockReturnValue({
      user: {
        uid: "guest-1",
        displayName: "ゲストA",
        email: null,
        isAnonymous: true,
      } as unknown as ReturnType<typeof useAuthUser>["user"],
      loading: false,
      refreshUser: vi.fn(),
    });

    await act(async () => {
      render(<JoinClient tid="t1" />);
    });

    // ゲスト受付後にアカウントへ移行したい需要があるためタブ自体は残す。
    expect(screen.getByRole("tab", { name: "ログイン" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新規登録" })).toBeInTheDocument();
    // 既定の「ゲスト」タブでは警告を出さない
    expect(screen.queryByText(/別の参加者として受付されます/)).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "新規登録" }));
    expect(screen.getByText(/別の参加者として受付されます/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "ログイン" }));
    expect(screen.getByText(/別の参加者として受付されます/)).toBeInTheDocument();
  });

  it("新規登録タブ表示中にサインインが確定したら、選択タブをゲストへ畳む", async () => {
    // authLoading 中は user が null で 3 タブが出る。認証確定でタブが消えたときに
    // 「選択中タブの中身が消えて画面が空白になる」ことを防ぐ effect の契約。
    mockAuthUser(null);
    const { rerender } = render(<JoinClient tid="t1" />);
    fireEvent.click(screen.getByRole("tab", { name: "新規登録" }));
    expect(screen.getByRole("tab", { name: "新規登録" })).toHaveAttribute("aria-selected", "true");

    mockAuthUser(signedInUser());
    await act(async () => {
      rerender(<JoinClient tid="t1" />);
    });

    expect(screen.queryByRole("tab", { name: "新規登録" })).toBeNull();
    expect(screen.getByRole("tab", { name: "ゲスト" })).toHaveAttribute("aria-selected", "true");
    // 畳んだ先の中身が描画されている（空白画面にならない）
    expect(screen.getByRole("button", { name: "ゲストで受付" })).toBeInTheDocument();
  });

  it("サインイン確定後も受付失敗の理由は残り、復旧案内が「このアカウントで受付」に変わる", async () => {
    // 登録自体は成功しているため、直後に onAuthStateChanged でサインインが確定する。
    // このときタブ自動切替が走るが、失敗理由まで消すと画面から原因が消えてしまう。
    mockAuthUser(null);
    vi.mocked(joinAsNewUser).mockRejectedValue(
      new EntryFailedAfterRegister(
        new AppError("レイトエントリー期限を過ぎています", "tournament/late-entry-closed"),
      ),
    );

    const { rerender } = await submitRegisterTab({
      displayName: "Alice",
      email: "alice@example.com",
      password: "pass123456",
    });
    expect(screen.getByText(/「ログイン」タブから同じメールアドレスで/)).toBeInTheDocument();

    mockAuthUser(signedInUser());
    await act(async () => {
      rerender(<JoinClient tid="t1" />);
    });

    // ログインタブが消えるので、案内先を「上の このアカウントで受付」に切り替える
    expect(screen.getByText(/上の「このアカウントで受付」から/)).toBeInTheDocument();
    expect(screen.queryByText(/「ログイン」タブから同じメールアドレスで/)).toBeNull();
    // タブ自動切替で失敗理由まで消さない（消すと再試行の判断材料が画面から失われる）。
    // 表示文言そのものは EntryFailedAfterRegister が原因の code / message を
    // 引き継ぐかに依存するため、その契約は receipt.test.ts 側で固定している。
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("JoinClient — 共有入力部品の配線（08 Phase 3）", () => {
  // ゲスト / ログインの各フォームは Phase 3 で DisplayNameField / EmailPasswordFields に
  // 差し替えた。部品側の単体テストとは別に、受付 service への配線が保たれているかを見る。
  beforeEach(() => {
    mockAuthUser(null);
  });

  it("ゲストタブの入力は trim して joinAsGuest に渡る", async () => {
    vi.mocked(joinAsGuest).mockResolvedValue({ result: "created", autoJoin: null });
    render(<JoinClient tid="t1" />);

    fireEvent.change(screen.getByLabelText("表示名"), { target: { value: "  Alice  " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ゲストで受付" }));
    });

    expect(joinAsGuest).toHaveBeenCalledWith({ tid: "t1", displayName: "Alice" });
    expect(await screen.findByText("受付完了")).toBeInTheDocument();
  });

  it("ゲストタブでも表示名が 15 字超なら送信前に弾く", async () => {
    render(<JoinClient tid="t1" />);

    fireEvent.change(screen.getByLabelText("表示名"), { target: { value: "あ".repeat(16) } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ゲストで受付" }));
    });

    expect(joinAsGuest).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("validation/join");
  });

  it("ログインタブの 2 項目は joinAsExistingUser に渡る", async () => {
    vi.mocked(joinAsExistingUser).mockResolvedValue({
      result: "already-joined",
      autoJoin: { gid: "g1", status: "already-member" },
    });
    render(<JoinClient tid="t1" />);

    fireEvent.click(screen.getByRole("tab", { name: "ログイン" }));
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "pass123456" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ログインして受付" }));
    });

    expect(joinAsExistingUser).toHaveBeenCalledWith({
      tid: "t1",
      email: "alice@example.com",
      password: "pass123456",
    });
    expect(await screen.findByText("既に参加済みです")).toBeInTheDocument();
  });

  it("ログイン失敗は受付完了へ進めず、エラーを表示する", async () => {
    vi.mocked(joinAsExistingUser).mockRejectedValue(
      new AppError("メールアドレスまたはパスワードが違います", "auth/invalid-credential"),
    );
    render(<JoinClient tid="t1" />);

    fireEvent.click(screen.getByRole("tab", { name: "ログイン" }));
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "wrong" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ログインして受付" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("auth/invalid-credential");
    expect(screen.queryByText("受付完了")).toBeNull();
  });
});
