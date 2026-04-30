"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePageTitle } from "@/components/nav/page-title";
import { QrPanel } from "@/components/qr/QrPanel";
import { AverageStackCard } from "@/components/tournament/AverageStackCard";
import { BalancingInstructionCard } from "@/components/tournament/BalancingInstructionCard";
import { NextBreakCard } from "@/components/tournament/NextBreakCard";
import { PlayerList } from "@/components/tournament/PlayerList";
import { PlayersCard } from "@/components/tournament/PlayersCard";
import { SeatingBoard } from "@/components/tournament/SeatingBoard";
import { StructureSnapshotCard } from "@/components/tournament/StructureSnapshotCard";
import { TimerControls } from "@/components/tournament/TimerControls";
import { TimerDisplay } from "@/components/tournament/TimerDisplay";
import { WinnerBanner } from "@/components/tournament/WinnerBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppError, unwrapOrFrom } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { updateAudioSettings } from "@/lib/firebase/repositories/groups";
import { subscribePlayers } from "@/lib/firebase/repositories/players";
import { subscribeTables } from "@/lib/firebase/repositories/tables";
import {
  deleteTournament,
  finishTournament,
} from "@/lib/firebase/repositories/tournaments";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import { useAudioPlayer } from "@/lib/hooks/useAudioPlayer";
import { useSeatingAutoOrchestrator } from "@/lib/hooks/useSeatingAutoOrchestrator";
import { useTournamentTimer } from "@/lib/hooks/useTournamentTimer";
import { deriveRole } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";
import { useCurrentGroup } from "@/lib/services/current-group";
import { getLevelInfo, resolveWinner } from "@/lib/services/timer";
import {
  canDelete as canDeleteTournament,
  canEdit as canEditTournament,
  isInProgress,
  showSeatingBoard as showSeatingBoardForState,
} from "@/lib/services/tournament-state";

const AUTO_FINISH_DELAY_MS = 2000;

export function DashboardClient({ tid }: { tid: string }) {
  const { user } = useAuthUser();
  const router = useRouter();
  const { groupIds, groups, loading: groupsLoading, refreshGroups } = useCurrentGroup();

  // 認証済みユーザー全員に autoAdvance opts を渡す。実際の per-tournament group
  // メンバーシップ check は useTournamentTimer 内（および orchestrator 内 tx）で
  // 行われるため、ここでは tournament.groupId を待たずに opts を確定できる。
  const {
    tournament: data,
    remainingMs,
    fromCache,
    lastSyncAt,
    error: timerError,
  } = useTournamentTimer(tid, {
    autoAdvance: user ? { uid: user.uid, userGroupIds: groupIds } : undefined,
  });

  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [players, setPlayers] = useState<PlayerDoc[]>([]);
  const [playersError, setPlayersError] = useState<string | null>(null);
  const [tables, setTables] = useState<TableDoc[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Phase 4.14 追加要望: トーナメント名を AppRoot のグローバルヘッダ（「ALLin-PokerTimer」
  // と同じ行）の中央 slot に出す。data ロード前は null（slot 非表示）。
  // 早期 return より前に呼び、hook 呼び出し順を一定に保つ。
  usePageTitle(data?.name ?? null);

  // Phase 4.14: Fullscreen API でブラウザ chrome を非表示にして同 dashboard を全画面化する。
  //   - `fullscreenchange` を購読して Esc 解除も含めてアイコン状態を同期。
  //   - Safari 系の `webkit*` も保険で OR 登録（PC 想定だが負担が小さいため）。
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => {
      const fsEl =
        document.fullscreenElement ??
        (document as Document & { webkitFullscreenElement?: Element | null })
          .webkitFullscreenElement ??
        null;
      setIsFullscreen(!!fsEl);
    };
    handler(); // 初期同期（既に他経路で fullscreen 化されている場合の保険）
    document.addEventListener("fullscreenchange", handler);
    document.addEventListener("webkitfullscreenchange", handler);
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      document.removeEventListener("webkitfullscreenchange", handler);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (e) {
      const wrapped = AppError.from(e, "ui/fullscreen-failed", "全画面化に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
    }
  }, []);

  // Phase 4: dashboard で players と tables を 1 度だけ subscribe し、
  // PlayerList / SeatingBoard / BalancingInstructionCard / TimerControls に伝搬。
  useEffect(() => {
    setPlayersError(null);
    const unsub = subscribePlayers(
      tid,
      (list) => setPlayers(list),
      (err) => {
        logger.warn(err.message, { code: err.code });
        setPlayersError(`${err.code}: ${err.message}`);
      },
    );
    return unsub;
  }, [tid]);

  useEffect(() => {
    const unsub = subscribeTables(
      tid,
      (list) => setTables(list),
      (err) => {
        logger.warn(err.message, { code: err.code });
        // tables 購読失敗は致命ではない（席決め前は空でも UI は表示できる）。warn のみ。
      },
    );
    return unsub;
  }, [tid]);

  useSeatingAutoOrchestrator({
    tid,
    uid: user?.uid ?? null,
    userGroupIds: groupIds,
    tournament: data,
    players,
    tables,
  });

  // Phase 4.5: 残り 1 人になった時点で 2 秒後に自動で finishTournament を呼ぶ。
  // 参加者端末（非 group メンバー）では rule 違反になるため dashboard（運営者側）のみで trigger。
  // 冪等性は finishTournament 内部で担保（state === "finished" なら no-op）。
  //
  // 依存は primitive (winner?.id / data?.state 等) に絞り、Firestore snapshot の
  // 再発行で deps オブジェクト参照が変わっても不要な再装填を起こさないようにする。
  const winner = useMemo(
    () => (data ? resolveWinner(data, players) : null),
    [data, players],
  );
  const winnerId = winner?.id ?? null;
  const dataId = data?.id;
  const dataState = data?.state;
  const dataGroupId = data?.groupId;
  const userUid = user?.uid;

  const autoFinishInflightRef = useRef(false);
  useEffect(() => {
    if (!userUid || !dataId || !dataGroupId) return;
    if (!groupIds.includes(dataGroupId)) return;
    if (dataState !== "running" && dataState !== "paused") return;
    if (!winnerId) return;
    if (autoFinishInflightRef.current) return;

    autoFinishInflightRef.current = true;
    const capturedGroupIds = groupIds;
    const timer = setTimeout(() => {
      void finishTournament(dataId, userUid, capturedGroupIds).catch((e) => {
        const code = e instanceof AppError ? e.code : "unknown";
        logger.warn("auto finish failed", { code, tid: dataId });
        autoFinishInflightRef.current = false;
      });
    }, AUTO_FINISH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      autoFinishInflightRef.current = false;
    };
  }, [winnerId, dataId, dataState, dataGroupId, userUid, groupIds]);

  // Phase 4.6: 一般メンバー（または非メンバー）は dashboard を閲覧できないため /live にリダイレクト。
  // data.groupId が判明し、groups ロード完了後に判定する（判定前の flash 防止のため render 側で loading 表示）。
  const tournamentGroupId = data?.groupId;
  useEffect(() => {
    if (!user) return;
    if (groupsLoading) return;
    if (!tournamentGroupId) return;
    const g = groups.find((x) => x.id === tournamentGroupId);
    const role = g ? deriveRole(g, user.uid) : null;
    if (role !== "owner" && role !== "organizer") {
      router.replace(`/tournaments/${tid}/live`);
    }
  }, [user, groupsLoading, groups, tournamentGroupId, router, tid]);

  // tournament の groupId に紐づく group ドキュメント。
  //   - 早期 return 前に確定する（後段の useAudioPlayer / role gate で使う）。
  //   - 命名は `tournamentGroup` で統一する（`useCurrentGroup().currentGroup` とは別物）。
  const tournamentGroup = data ? groups.find((x) => x.id === data.groupId) ?? null : null;

  // Phase 4.9: 音声通知。早期 return 前に呼ぶことで hooks の呼び出し順を一定に保つ。
  // 引数は null 許容で、role が owner/organizer 以外なら hook 内部で no-op になる。
  const audioRole = user && tournamentGroup ? deriveRole(tournamentGroup, user.uid) : null;
  const audioPlayer = useAudioPlayer({
    tournament: data,
    group: tournamentGroup,
    players,
    role: audioRole,
  });

  async function onDelete() {
    if (!user) return;
    try {
      await deleteTournament(tid, user.uid, groupIds);
      router.push("/tournaments");
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "削除失敗");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(`${wrapped.code}: ${wrapped.message}`);
      setConfirmOpen(false);
    }
  }

  if (timerError) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        <p className="text-sm text-destructive" role="alert">
          {`${timerError.code}: ${timerError.message}`}
        </p>
      </main>
    );
  }

  if (!data || !user) {
    return <main className="mx-auto max-w-4xl p-8 text-sm text-muted-foreground">読込中…</main>;
  }

  // role 判定前 or 非 organizer の場合はローディング表示（useEffect で /live へ redirect 中）。
  const myRole = tournamentGroup ? deriveRole(tournamentGroup, user.uid) : null;
  const isOrganizer = myRole === "owner" || myRole === "organizer";
  if (groupsLoading || !isOrganizer) {
    return <main className="mx-auto max-w-4xl p-8 text-sm text-muted-foreground">読込中…</main>;
  }

  const isMember = groupIds.includes(data.groupId);
  const canEdit = isMember && canEditTournament(data);
  // 上の guard で isOrganizer (= isMember) が確定しているため state のみで判定。
  const canDelete = canDeleteTournament(data);
  const showSeatingBoard = showSeatingBoardForState(data);
  const showBalancing = isMember && isInProgress(data);
  const levelInfo = getLevelInfo(data);
  // Phase 4.14: state 遷移で grid 列数を跳ねさせない。常に 3 列固定で、各カード内部で
  // 開始前 / 受付中 / 進行中 の表示分岐を持つ。
  const gridColsClass =
    "lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,260px)]";

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-8 lg:max-w-7xl">
      {/*
        Phase 4.14 追加要望（差分）:
          - トーナメント名は AppRoot のグローバルヘッダ（「ALLin-PokerTimer」と同じ高さ）の
            中央スロットへ register 経由で表示する（usePageTitle）。
          - 旧「レイトレジスト Lv{n}」表示は QrPanel の URL ↔ QR の間に移動。
          - 「同期中」ConnectionBadge は TimerControls の全画面アイコンの左に移動。
          - 「全画面表示」アイコンは TimerControls のサウンドアイコンの左に移動。
        ここのローカル `<header>` は edit / delete ボタンだけを右寄せで保持する。
        どちらも非表示（running 等）の state ではこのヘッダ行は事実上 0 高さの空行になる。
      */}
      <header className="flex flex-wrap justify-end gap-2 empty:hidden">
        {canEdit ? (
          <Link href={`/tournaments/${tid}/edit`}>
            <Button variant="outline" size="sm">
              編集
            </Button>
          </Link>
        ) : null}
        {canDelete ? (
          <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
            削除
          </Button>
        ) : null}
      </header>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {/*
        上段 — 等高 3 列。lg+ で QR / タイマー+操作 / 統計 3 カードを同じ高さに揃える。
        最も背の高い QrPanel を基準に他 2 列が伸びる。
        sticky は等高化と両立しないため廃止（Phase 4.11 までは sticky だった）。
        Phase 4.14: state 遷移で grid 列数を跳ねさせないため常に 3 列固定。
        各カードは内部で setup/seating（受付中）と running 以降を出し分ける。
        trace: phase-4.14-dashboard-and-nav-polish.plan.md
      */}
      <div className={`grid grid-cols-1 gap-4 ${gridColsClass} lg:items-stretch`}>
        <aside className="order-3 lg:order-1">
          <QrPanel
            tid={tid}
            className="h-full"
            lateEntryDeadlineLevel={data.lateEntryDeadlineLevel}
          />
        </aside>

        <div className="order-1 flex flex-col gap-4 lg:order-2">
          <TimerDisplay
            tournament={data}
            remainingMs={remainingMs}
            levelInfo={levelInfo}
            className="flex-1 justify-center"
          />
          {/* タイマー操作 — タイマー直下に中央揃えでアイコンボタン群を並べる。
              サウンド On/Off は audio props（運営者ロール時のみ）。 */}
          {isMember ? (
            <TimerControls
              tid={tid}
              uid={user.uid}
              userGroupIds={groupIds}
              tournament={data}
              players={players}
              fullscreen={{
                isFullscreen,
                onToggle: () => {
                  void toggleFullscreen();
                },
              }}
              connection={{ fromCache, lastSyncAt }}
              audio={
                tournamentGroup
                  ? {
                      enabled: tournamentGroup.audioSettings.enabled,
                      unlocked: audioPlayer.unlocked,
                      onUnlock: audioPlayer.unlock,
                      onToggleEnabled: async (next: boolean) => {
                        try {
                          await updateAudioSettings(tournamentGroup.id, {
                            ...tournamentGroup.audioSettings,
                            enabled: next,
                          });
                        } catch (e) {
                          // updateAudioSettings 内で既に AppError wrap + logger.warn 済み。
                          // 二重ログを避けるため unwrapOrFrom で既存 wrap を尊重しつつ
                          // 未 wrap の場合のみ補完して UI 表示する。
                          const err = unwrapOrFrom(
                            e,
                            "firestore/write_failed",
                            "サウンド設定の更新に失敗しました",
                          );
                          setError(`${err.code}: ${err.message}`);
                          return;
                        }
                        // Phase 4.14: GroupProvider は onSnapshot 購読していないため、
                        // 書込み成功後に one-shot 再読込してボタン状態を即時反映する。
                        // best-effort で十分（refreshGroups は内部で warn して握り、reject しない）。
                        void refreshGroups();
                      },
                    }
                  : undefined
              }
              onError={setError}
            />
          ) : null}
        </div>

        <aside className="order-2 grid grid-rows-[repeat(3,minmax(0,1fr))] gap-3 lg:order-3">
          <NextBreakCard tournament={data} remainingMs={remainingMs} className="h-full" />
          <AverageStackCard tournament={data} players={players} className="h-full" />
          <PlayersCard players={players} className="h-full" />
        </aside>
      </div>

      {winner ? <WinnerBanner winner={winner} /> : null}

      {showBalancing ? (
        <BalancingInstructionCard
          tid={tid}
          uid={user.uid}
          userGroupIds={groupIds}
          players={players}
          tables={tables}
          seatsPerTable={data.seatsPerTable}
          onError={setError}
        />
      ) : null}

      {showSeatingBoard ? (
        <Card>
          <CardHeader>
            <CardTitle>Table List</CardTitle>
          </CardHeader>
          <CardContent>
            <SeatingBoard
              players={players}
              tables={tables}
              seatsPerTable={data.seatsPerTable}
              currentUid={user.uid}
            />
          </CardContent>
        </Card>
      ) : null}

      <PlayerList
        tid={tid}
        players={players}
        subscribeError={playersError}
        canManage={isMember}
        tournamentState={data.state}
      />

      <StructureSnapshotCard
        snapshot={data.structureSnapshot}
        currentLevel={data.currentLevel}
        showDescription
      />


      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>トーナメントを削除</DialogTitle>
            <DialogDescription>
              {data.state === "setup"
                ? `「${data.name}」を削除します。開始前のため安全に削除できます。`
                : `「${data.name}」を削除します。終了済みのため履歴ごと削除されます。参加者・卓情報も同時に消去されます。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void onDelete();
              }}
            >
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
