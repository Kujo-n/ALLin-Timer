"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { usePageTitle } from "@/components/nav/page-title";
import { QrPanel } from "@/components/qr/QrPanel";
import { AverageStackCard } from "@/components/tournament/AverageStackCard";
import { BalancingInstructionCard } from "@/components/tournament/BalancingInstructionCard";
import { CloseTableConfirmDialog } from "@/components/tournament/CloseTableConfirmDialog";
import { DeviceFallbackHints } from "@/components/tournament/DeviceFallbackHints";
import { NextBreakCard } from "@/components/tournament/NextBreakCard";
import { OfflineBanner } from "@/components/tournament/OfflineBanner";
import { PlayerList } from "@/components/tournament/PlayerList";
import { PlayersCard } from "@/components/tournament/PlayersCard";
import { SeatingBoard } from "@/components/tournament/SeatingBoard";
import { SpectateModeCard } from "@/components/tournament/SpectateModeCard";
import { StructureSnapshotCard } from "@/components/tournament/StructureSnapshotCard";
import { TimerControls } from "@/components/tournament/TimerControls";
import { TimerDisplay } from "@/components/tournament/TimerDisplay";
import { WinnerBanner } from "@/components/tournament/WinnerBanner";
import { WinnerCardDownloadButton } from "@/components/tournament/WinnerCardDownloadButton";
import { ShareCardButton } from "@/components/share/_share-button/ShareCardButton";
import { formatWinnerShareText } from "@/components/share/_share-button/share-text";
import { buildWinnerShareInputs } from "@/app/api/og/_lib/og-payload";
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
import { formatErrorForDisplay, unwrapOrFrom } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { updateAudioSettings } from "@/lib/firebase/repositories/groups";
import { isOrganizerRole } from "@/lib/firebase/schemas/group";
import { subscribePlayers } from "@/lib/firebase/repositories/players";
import { subscribeTables, updateTableLabel } from "@/lib/firebase/repositories/tables";
import {
  appendLevel,
  deleteTournament,
  setLevelDurationSec,
} from "@/lib/firebase/repositories/tournaments";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import { useAudioPlayer } from "@/lib/hooks/useAudioPlayer";
import { useAutoFinish } from "@/lib/hooks/useAutoFinish";
import { useFullscreen } from "@/lib/hooks/useFullscreen";
import { useGroupRole } from "@/lib/hooks/useGroupRole";
import { useManualSeatChange } from "@/lib/hooks/useManualSeatChange";
import { useOrientationLock } from "@/lib/hooks/useOrientationLock";
import { useSeatingAutoOrchestrator } from "@/lib/hooks/useSeatingAutoOrchestrator";
import { useTableClose } from "@/lib/hooks/useTableClose";
import { useTournamentTimer } from "@/lib/hooks/useTournamentTimer";
import { useWakeLock } from "@/lib/hooks/useWakeLock";
import { logger } from "@/lib/logger";
import { useCurrentGroup } from "@/lib/services/current-group";
import { setIsPlayingDealer } from "@/lib/services/seating/orchestrator";
import { getSameTableActiveOtherIds } from "@/lib/services/seating/same-table";
import { getLevelInfo, resolveWinner } from "@/lib/services/timer";
import {
  canAppendLevel,
  canClone,
  canDelete as canDeleteTournament,
  canEdit as canEditTournament,
  isAcceptingProxyEntry,
  isInProgress,
  isRunning,
  isSetup,
  showSeatingBoard as showSeatingBoardForState,
} from "@/lib/services/tournament-state";

export function DashboardClient({ tid }: { tid: string }) {
  const { user } = useAuthUser();
  const router = useRouter();
  const { groupIds, loading: groupsLoading, refreshGroups } = useCurrentGroup();

  // 認証済みユーザー全員に autoAdvance opts を渡す。実際の per-tournament group
  // メンバーシップ check は useTournamentTimer 内（および orchestrator 内 tx）で
  // 行われるため、ここでは tournament.groupId を待たずに opts を確定できる。
  const {
    tournament: data,
    remainingMs,
    fromCache,
    hasPendingWrites,
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

  // Phase 4.14 追加要望: トーナメント名を AppRoot のグローバルヘッダ（「ALLin-PokerTimer」
  // と同じ行）の中央 slot に出す。data ロード前は null（slot 非表示）。
  // 早期 return より前に呼び、hook 呼び出し順を一定に保つ。
  usePageTitle(data?.name ?? null);

  // Phase 4.14: Fullscreen API でブラウザ chrome を非表示にして同 dashboard を全画面化。
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

  // Phase C: 会場プロジェクタ投影中の画面消灯防止 / 横向き固定。
  // running の間だけ Wake Lock を取得（paused / setup / seating / finished では release）。
  // Orientation Lock は PWA standalone のときだけ実際に動く（hook 内で feature detection）。
  const wakeLock = useWakeLock(data ? isRunning(data) : false);
  useOrientationLock("landscape");

  // Phase 4: dashboard で players と tables を 1 度だけ subscribe し、
  // PlayerList / SeatingBoard / BalancingInstructionCard / TimerControls に伝搬。
  useEffect(() => {
    setPlayersError(null);
    const unsub = subscribePlayers(
      tid,
      (list) => setPlayers(list),
      (err) => {
        logger.warn(err.message, { code: err.code });
        setPlayersError(formatErrorForDisplay(err));
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
  // 参加者端末（非 group メンバー）では rule 違反になるため dashboard（運営者側）のみ。
  // 冪等性は finishTournament 内部で担保（state === "finished" なら no-op）。
  const winner = useMemo(
    () => (data ? resolveWinner(data, players) : null),
    [data, players],
  );
  useAutoFinish({
    tournament: data,
    winnerId: winner?.id ?? null,
    uid: user?.uid,
    groupIds,
  });

  // tournament の groupId に紐づく group ドキュメントとロールを 1 回で導出。
  //   - 早期 return 前に確定する（useAudioPlayer / role gate で参照）。
  //   - 命名は `tournamentGroup` で統一（`useCurrentGroup().currentGroup` とは別物）。
  const { group: tournamentGroup, role: myRole } = useGroupRole(data?.groupId);

  // Phase 4.6: 一般メンバー（または非メンバー）は dashboard を閲覧できないため /live にリダイレクト。
  // data.groupId が判明し、groups ロード完了後に判定する（判定前の flash 防止のため render 側で loading 表示）。
  useEffect(() => {
    if (!user) return;
    if (groupsLoading) return;
    if (!data?.groupId) return;
    if (myRole !== "owner" && myRole !== "organizer") {
      router.replace(`/tournaments/${tid}/live`);
    }
  }, [user, groupsLoading, data?.groupId, myRole, router, tid]);

  // Phase 4.9: 音声通知。早期 return 前に呼ぶことで hooks の呼び出し順を一定に保つ。
  // 引数は null 許容で、role が owner/organizer 以外なら hook 内部で no-op になる。
  // onError: 再生失敗（autoplay block / 出力デバイス不在 / SW cache 破損 等）を運営者に
  // 可視化する。logger.warn と二重通知になるが、開発者ツールを開かない運用者向けに UI で見せる。
  const audioPlayer = useAudioPlayer({
    tournament: data,
    group: tournamentGroup,
    players,
    role: myRole,
    remainingMs,
    onError: setError,
  });

  async function onDelete() {
    if (!user) return;
    try {
      await deleteTournament(tid, user.uid, groupIds);
      router.push("/tournaments");
    } catch (e) {
      // deleteTournament は内部で warn 済み。UI 表示のみここで担当する。
      const err = unwrapOrFrom(e, "firestore/write_failed", "削除失敗");
      setError(formatErrorForDisplay(err));
      setConfirmOpen(false);
    }
  }

  // サウンドトグルの inline handler を集約。tournamentGroup が確定していない場合は
  // TimerControls の audio prop 側で undefined になり呼ばれない。
  async function onToggleAudioEnabled(next: boolean) {
    if (!tournamentGroup) return;
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
      setError(formatErrorForDisplay(err));
      return;
    }
    // Phase 4.14: GroupProvider は onSnapshot 購読していないため、
    // 書込み成功後に one-shot 再読込してボタン状態を即時反映する。
    // best-effort で十分（refreshGroups は内部で warn して握り、reject しない）。
    void refreshGroups();
  }

  // Phase 5.x: D&D による手動席移動の state / 30 秒 undo banner / cascade 適用は
  // useManualSeatChange hook に集約済み。dashboard 側は busy / undoBanner /
  // 2 つの handler を SeatingBoard と undo banner UI に渡すだけ。
  const {
    busy: seatChangeBusy,
    undoBanner: seatChangeUndo,
    handleMoveSeat,
    handleUndoSeatChange,
  } = useManualSeatChange({
    tid,
    uid: user?.uid ?? null,
    groupIds,
    players,
    onError: setError,
  });

  // Phase 3 (07): 運営者による手動卓閉鎖の state / busy / orchestrator 呼出は
  // useTableClose hook に集約。dashboard は SeatingBoard の「閉じる」ボタンと
  // CloseTableConfirmDialog に handler / state を渡すだけ。
  const {
    pendingTableNum: closeTableNum,
    busy: closeTableBusy,
    requestClose,
    cancelClose,
    confirmClose,
  } = useTableClose({
    tid,
    uid: user?.uid ?? null,
    groupIds,
    players,
    tables,
    onError: setError,
  });

  // SeatingBoard / PlayerList の PD checkbox 両方で同形の handler を渡すため集約。
  // 同卓 1 PD 制約の tx race guard は orchestrator.setIsPlayingDealer 内で行われる。
  const handleTogglePd = useCallback(
    async (player: PlayerDoc, value: boolean) => {
      if (!user) return;
      const tableMates = getSameTableActiveOtherIds(player, players);
      await setIsPlayingDealer(
        tid,
        user.uid,
        groupIds,
        player.id,
        value,
        tableMates,
      );
    },
    [tid, user, groupIds, players],
  );

  if (timerError) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        <p className="text-sm text-destructive" role="alert">
          {formatErrorForDisplay(timerError)}
        </p>
      </main>
    );
  }

  if (!data || !user) {
    return <main className="mx-auto max-w-4xl p-8 text-sm text-muted-foreground">読込中…</main>;
  }

  // role 判定前 or 非 organizer の場合はローディング表示（useEffect で /live へ redirect 中）。
  const isOrganizer = isOrganizerRole(myRole);
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
        Phase B: 通信障害中 / 同期中の状態を 1 つの帯で運営者に伝える。online で
        pending writes も無いときは null を返して占有領域 0。
        ConnectionBadge は引き続き TimerControls 内で「最終同期時刻」を表示する補助 UI。
      */}
      <OfflineBanner fromCache={fromCache} hasPendingWrites={hasPendingWrites} />
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
                      onToggleEnabled: onToggleAudioEnabled,
                    }
                  : undefined
              }
              onError={setError}
            />
          ) : null}
          {/*
            Phase C: Wake Lock 未対応端末向けのテキスト案内。
            running 中のみ表示し、未対応 UA（iOS Safari < 16.4 等）以外では何も描画しない。
          */}
          {isRunning(data) ? (
            <DeviceFallbackHints wakeLockSupported={wakeLock.supported} />
          ) : null}
        </div>

        <aside className="order-2 grid grid-rows-[repeat(3,minmax(0,1fr))] gap-3 lg:order-3">
          <NextBreakCard tournament={data} remainingMs={remainingMs} className="h-full" />
          <AverageStackCard tournament={data} players={players} className="h-full" />
          <PlayersCard players={players} className="h-full" />
        </aside>
      </div>

      {winner ? (
        (() => {
          // ShareCardButton と WinnerCardDownloadButton で同じ url / filenameStem を使うため
          // helper を 1 度呼んで両方に渡す（Phase D follow-up: og-payload に集約済）。
          const finishedAtDate = data.finishedAt?.toDate() ?? new Date();
          const winnerCardBackground = tournamentGroup?.winnerCardBackground ?? null;
          const shareInputs = buildWinnerShareInputs(tid, {
            winnerName: winner.displayName,
            tournamentName: data.name,
            participants: players.length,
            finishedAt: finishedAtDate,
            groupName: tournamentGroup?.name,
            cardBackground: winnerCardBackground,
          });
          const shareText = formatWinnerShareText({
            tournamentName: data.name,
            winnerName: winner.displayName,
            participants: players.length,
          });
          return (
            <>
              <WinnerBanner winner={winner} />
              <div className="flex flex-wrap items-center justify-center gap-2">
                <ShareCardButton
                  url={shareInputs.url}
                  filenameStem={shareInputs.filenameStem}
                  shareText={shareText}
                  kind="winner"
                  label="シェア"
                  dataTestId="winner-card-share"
                />
                <WinnerCardDownloadButton
                  tid={tid}
                  winnerName={winner.displayName}
                  tournamentName={data.name}
                  participants={players.length}
                  finishedAt={finishedAtDate}
                  groupName={tournamentGroup?.name}
                  cardBackground={winnerCardBackground}
                />
              </div>
            </>
          );
        })()
      ) : null}

      {isOrganizer && canClone(data) ? (
        <div className="flex justify-center">
          <Button asChild size="lg">
            <Link href={`/tournaments/${tid}/clone`}>
              同じ参加者で次のトーナメントを作成
            </Link>
          </Button>
        </div>
      ) : null}

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

      {seatChangeUndo ? (
        <Card className="border-blue-500/60 bg-blue-50/60 dark:bg-blue-950/20">
          <CardContent className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">{seatChangeUndo.summary}</p>
            <Button
              size="sm"
              variant="outline"
              disabled={seatChangeBusy}
              onClick={() => void handleUndoSeatChange()}
            >
              元に戻す
            </Button>
          </CardContent>
        </Card>
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
              canManage={isMember}
              onError={setError}
              onMoveSeat={handleMoveSeat}
              dndBusy={seatChangeBusy}
              // Phase C: 卓 label / color の inline edit を organizer に開放。
              // SeatingBoard が表示される state（seating / running / paused / finished）の全段で edit 可能。
              canEditTableLabel={isOrganizer}
              onSaveTableLabel={async (tableNum, patch) => {
                await updateTableLabel(tid, tableNum, patch);
              }}
              onTogglePd={handleTogglePd}
              // Phase 3 (07): 任意卓を閉じる。SeatingBoard が出る = seating 以降のため isMember で十分。
              canCloseTable={isMember}
              onCloseTable={requestClose}
            />
          </CardContent>
        </Card>
      ) : null}

      <CloseTableConfirmDialog
        tableNum={closeTableNum}
        players={players}
        tables={tables}
        busy={closeTableBusy}
        onConfirm={() => void confirmClose()}
        onCancel={cancelClose}
      />

      <PlayerList
        tid={tid}
        players={players}
        subscribeError={playersError}
        canManage={isMember}
        tournamentState={data.state}
        onTogglePd={handleTogglePd}
        group={tournamentGroup}
        organizerUid={user.uid}
        canAddParticipant={isAcceptingProxyEntry(data)}
      />

      <StructureSnapshotCard
        snapshot={data.structureSnapshot}
        currentLevel={data.currentLevel}
        showDescription
        tournament={data}
        canEdit={isOrganizer}
        onUpdateDurationSec={async (levelIndex, durationSec) => {
          await setLevelDurationSec(tid, user.uid, groupIds, levelIndex, durationSec);
        }}
        onEditError={setError}
        canAppend={isOrganizer && canAppendLevel(data)}
        onAppendLevel={async (input) => {
          await appendLevel(tid, user.uid, groupIds, input);
        }}
      />

      {/*
        Phase 3 (04-spectate-mode): 観戦モード toggle / URL コピー / QR。
          - ページ最下部に配置（運営の core UX を阻害せず、観戦は補助機能の位置付け）。
          - dashboard 自体が organizer-only redirect 済み（line 167-174 / 256-258）。
          - Card 内部でも防御として props.uid を必須化し、role check の最終ラインは Firestore Rules。
          - 後続 <Dialog>（削除確認）はモーダルで通常非描画のため、本 Card が <main> 内の最終
            visible 要素になる（winner 確定時でも上半分にしか出ない WinnerBanner / ShareCard より下）。
      */}
      <SpectateModeCard
        tid={tid}
        enabled={data.spectateEnabled}
        uid={user.uid}
        onError={setError}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>トーナメントを削除</DialogTitle>
            <DialogDescription>
              {isSetup(data)
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
