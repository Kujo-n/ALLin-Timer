"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { SoundUnlockBanner } from "@/components/audio/SoundUnlockBanner";
import { QrPanel } from "@/components/qr/QrPanel";
import { AverageStackCard } from "@/components/tournament/AverageStackCard";
import { ConnectionBadge } from "@/components/tournament/ConnectionBadge";
import { NextBreakCard } from "@/components/tournament/NextBreakCard";
import { OfflineBanner } from "@/components/tournament/OfflineBanner";
import { PlayersCard } from "@/components/tournament/PlayersCard";
import { StructureSnapshotCard } from "@/components/tournament/StructureSnapshotCard";
import { TimerDisplay } from "@/components/tournament/TimerDisplay";
import { WinnerBanner } from "@/components/tournament/WinnerBanner";
import { WinnerCardDownloadButton } from "@/components/tournament/WinnerCardDownloadButton";
import { ShareCardButton } from "@/components/share/_share-button/ShareCardButton";
import { formatWinnerShareText } from "@/components/share/_share-button/share-text";
import { buildWinnerShareInputs } from "@/app/api/og/_lib/og-payload";
import { Button } from "@/components/ui/button";
import { AppError, formatErrorForDisplay } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { subscribePlayers } from "@/lib/firebase/repositories/players";
import { subscribeTables } from "@/lib/firebase/repositories/tables";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import { useAudioPlayer } from "@/lib/hooks/useAudioPlayer";
import { useGroupRole } from "@/lib/hooks/useGroupRole";
import { useTournamentTimer } from "@/lib/hooks/useTournamentTimer";
import { logger } from "@/lib/logger";
import { attemptAnonymousSelfDelete } from "@/lib/services/auth-actions";
import { formatTableLabel } from "@/lib/services/format-table-label";
import { joinAsCurrentUser } from "@/lib/services/receipt";
import { getLevelInfo, resolveWinner } from "@/lib/services/timer";
import { isBeforeStart, isRunning } from "@/lib/services/tournament-state";

const MOVED_BANNER_MS = 30_000;

export function LiveClient({ tid }: { tid: string }) {
  // /live は read-only。autoAdvance / auto-seat は渡さない（参加者端末は rule で書込不可）。
  const { tournament, remainingMs, fromCache, hasPendingWrites, lastSyncAt, error } =
    useTournamentTimer(tid);
  const { user, loading: authLoading } = useAuthUser();
  const router = useRouter();
  const [players, setPlayers] = useState<PlayerDoc[]>([]);
  // Phase C: 卓 label / color を表示するための tables subscribe。
  //   失敗時は warn のみで Live 表示自体は壊さない（fallback で `Table N` 表示）。
  const [tables, setTables] = useState<TableDoc[]>([]);
  // 購読が 1 回以上 fire したかで「読込中」と「参加者ではない」を区別する。
  // これがないとリロード直後の一瞬、参加者でありながら「レイトエントリー超過」等の
  // 誤メッセージが表示される（tournament state は先に解決され、players 購読は遅延するため）。
  const [playersLoaded, setPlayersLoaded] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  // Phase 5.1: 匿名ゲストは `/live` を閲覧できない設計（受付完了画面で動線完結）。
  // 直接アクセス時はホームへ redirect。loading 中は何もせず、確定後に判定。
  useEffect(() => {
    if (authLoading) return;
    if (user?.isAnonymous) router.replace("/");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    // Phase 5.1: 匿名ユーザーは別 useEffect で `/` に redirect 中。subscribePlayers は
    // best-effort で動かしておく（self-delete useEffect が participant マッチ時に
    // attemptAnonymousSelfDelete を発火するため、player 一覧が必要）。
    const unsub = subscribePlayers(
      tid,
      (list) => {
        setPlayers(list);
        setPlayersLoaded(true);
      },
      (err) => logger.warn("live players subscribe error", { code: err.code, tid }),
    );
    return unsub;
  }, [tid, user]);

  // Phase C: tables を subscribe して自分の卓の label を解決する。失敗時は warn のみ
  // （fallback で `Table N` 表示するため Live 画面は壊さない）。
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeTables(
      tid,
      (list) => setTables(list),
      (err) => logger.warn("live tables subscribe error", { code: err.code, tid }),
    );
    return unsub;
  }, [tid, user]);

  const me = user ? (players.find((p) => p.uid === user.uid) ?? null) : null;

  // Phase 4.9: 運営者ロール（owner/organizer）が /live を会場ディスプレイに投影しているケース。
  //   useGroupRole が tournament.groupId に対応する group + role をまとめて返す。
  //   member / 非メンバー / 匿名は role が member or null になり、useAudioPlayer 内で no-op。
  const { group: tournamentGroup, role: audioRole } = useGroupRole(tournament?.groupId);
  const isAudioOperator = audioRole === "owner" || audioRole === "organizer";
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioPlayer = useAudioPlayer({
    tournament,
    group: tournamentGroup,
    players,
    role: audioRole,
    // 再生失敗時は dashboard と同等に画面上のエラー表示で見せる。/live は organizer が
    // 会場ディスプレイに投影しているケースを含むため、サイレント failure は避ける。
    onError: setAudioError,
  });

  // 30 秒のバナー表示判定用に 1 秒間隔で再描画。
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Phase 4.5: 匿名参加者の自己削除。tournament finish 検知時に Firebase Auth と
  // users/{uid} を best-effort で削除する。player ドキュメントは履歴として残す。
  const selfDeleteInflightRef = useRef(false);
  useEffect(() => {
    if (!user || !user.isAnonymous) return;
    if (!tournament) return;
    if (tournament.state !== "finished") return;
    if (!me) return;
    if (selfDeleteInflightRef.current) return;
    selfDeleteInflightRef.current = true;

    void attemptAnonymousSelfDelete(user, "finish");
  }, [user, tournament, me, tid]);

  if (user?.isAnonymous) {
    return (
      <main className="mx-auto max-w-md p-6 text-sm text-muted-foreground">
        受付完了画面に戻ります…
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-md p-6">
        <p className="text-sm text-destructive" role="alert">
          {formatErrorForDisplay(error)}
        </p>
      </main>
    );
  }

  if (!tournament) {
    return <main className="mx-auto max-w-md p-6 text-sm text-muted-foreground">読込中…</main>;
  }

  const levelInfo = getLevelInfo(tournament);
  const seatedAt = me?.lastMovedAt ? me.lastMovedAt.toMillis() : null;
  const recentlyMoved =
    seatedAt !== null &&
    me?.tableNum != null &&
    me?.seatNum != null &&
    now - seatedAt < MOVED_BANNER_MS;
  const lateEntryClosed =
    tournament.currentLevel > tournament.lateEntryDeadlineLevel;
  const winner = resolveWinner(tournament, players);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4 pt-6">
      {/* Phase B: 接続切れ / 同期中バナー（参加者にも見せる）。
          ConnectionBadge は header 内に併存し、最終同期時刻を補助表示する。 */}
      <OfflineBanner fromCache={fromCache} hasPendingWrites={hasPendingWrites} />

      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold md:text-xl">{tournament.name}</h1>
        <div className="flex items-center gap-2">
          {isAudioOperator ? (
            <Link href={`/tournaments/${tid}`}>
              <Button variant="outline" size="sm">
                受付へ戻る
              </Button>
            </Link>
          ) : null}
          <ConnectionBadge fromCache={fromCache} lastSyncAt={lastSyncAt} />
        </div>
      </header>

      {/*
        PC（lg+）では 3 カラムレイアウト: 左=QR / 中=タイマー / 右=情報カード。
        モバイルでは 1 カラムで縦に並ぶ（order で配置調整）。
        trace: tmp/10_Phase4.9_memo.md 改善要望#4(右側) #5(左側)
      */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,260px)]">
        <aside className="order-3 space-y-3 lg:order-1 lg:sticky lg:top-4 lg:self-start">
          <QrPanel tid={tid} />
        </aside>

        <div className="order-1 flex flex-col gap-4 lg:order-2">
          <TimerDisplay
            tournament={tournament}
            remainingMs={remainingMs}
            levelInfo={levelInfo}
          />

          {isAudioOperator && tournamentGroup ? (
            <SoundUnlockBanner
              unlocked={audioPlayer.unlocked}
              enabled={tournamentGroup.audioSettings.enabled}
              onUnlock={audioPlayer.unlock}
            />
          ) : null}

          {audioError ? (
            <p
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100"
              role="alert"
            >
              {audioError}
            </p>
          ) : null}

          {winner ? (
            (() => {
              // Share / Download 両ボタンで同じ url / filenameStem / bgImageUrl を共有するため
              // `buildWinnerShareInputs` を 1 度呼んで両方に渡す（dashboard と同型）。
              const finishedAtDate =
                tournament.finishedAt?.toDate() ?? new Date();
              const winnerCardBackground =
                tournamentGroup?.winnerCardBackground ?? null;
              const shareInputs = buildWinnerShareInputs(tid, {
                winnerName: winner.displayName,
                tournamentName: tournament.name,
                participants: players.length,
                finishedAt: finishedAtDate,
                cardBackground: winnerCardBackground,
              });
              const shareText = formatWinnerShareText({
                tournamentName: tournament.name,
                winnerName: winner.displayName,
                participants: players.length,
              });
              return (
                <>
                  <WinnerBanner winner={winner} className="w-full" />
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
                      tournamentName={tournament.name}
                      participants={players.length}
                      finishedAt={finishedAtDate}
                      cardBackground={winnerCardBackground}
                    />
                  </div>
                </>
              );
            })()
          ) : null}

          {user ? (
            <section
              className="rounded-lg border p-4"
              aria-label="self-seat"
            >
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">あなたの席</h2>
              {!playersLoaded ? (
                <p className="text-sm text-muted-foreground">受付情報を取得中…</p>
              ) : me === null ? (
                <JoinSelfPanel
                  tid={tid}
                  canJoin={
                    (isBeforeStart(tournament) || isRunning(tournament)) &&
                    !lateEntryClosed
                  }
                  joining={joining}
                  error={joinError}
                  onJoin={async () => {
                    setJoining(true);
                    setJoinError(null);
                    try {
                      await joinAsCurrentUser({ tid });
                    } catch (e) {
                      const wrapped = AppError.from(
                        e,
                        "tournament/join-failed",
                        "参加登録に失敗しました",
                      );
                      logger.warn(wrapped.message, { code: wrapped.code, tid });
                      setJoinError(formatErrorForDisplay(wrapped));
                    } finally {
                      setJoining(false);
                    }
                  }}
                />
              ) : me.isBusted ? (
                <p className="text-sm text-muted-foreground">脱落済み</p>
              ) : me.tableNum !== null && me.seatNum !== null ? (
                <div className="space-y-2">
                  <dl className="flex gap-3">
                    <div className="flex-1 rounded-md border bg-muted/40 px-3 py-2 text-center">
                      <dt className="text-xs font-medium text-muted-foreground">Table</dt>
                      <dd
                        className="text-3xl font-bold tabular-nums"
                        data-testid="my-table"
                      >
                        {/* Phase C: label が設定されていればカスタム Table 名を表示。
                              tables subscribe が遅延 / 失敗していたら数値 fallback */}
                        {(() => {
                          const myTable = tables.find(
                            (t) => t.tableNum === me.tableNum,
                          );
                          if (!myTable) return me.tableNum;
                          const label = formatTableLabel(myTable);
                          return label === `Table ${me.tableNum}`
                            ? me.tableNum
                            : label;
                        })()}
                      </dd>
                    </div>
                    <div className="flex-1 rounded-md border bg-muted/40 px-3 py-2 text-center">
                      <dt className="text-xs font-medium text-muted-foreground">No.</dt>
                      <dd
                        className="text-3xl font-bold tabular-nums"
                        data-testid="my-seat"
                      >
                        {me.seatNum}
                      </dd>
                    </div>
                  </dl>
                  {recentlyMoved ? (
                    <p
                      className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                      role="status"
                    >
                      📣 席が移動しました
                    </p>
                  ) : null}
                </div>
              ) : isBeforeStart(tournament) ? (
                <p className="text-sm text-muted-foreground">席決め待ち中…</p>
              ) : lateEntryClosed ? (
                <p className="text-sm text-destructive">レイトエントリー締切超過です</p>
              ) : (
                <p className="text-sm text-muted-foreground">席決め待ち中…</p>
              )}
            </section>
          ) : null}

          <StructureSnapshotCard
            snapshot={tournament.structureSnapshot}
            currentLevel={tournament.currentLevel}
          />
        </div>

        <aside className="order-2 flex flex-col gap-3 lg:order-3 lg:sticky lg:top-4 lg:self-start">
          <NextBreakCard tournament={tournament} remainingMs={remainingMs} />
          <AverageStackCard tournament={tournament} players={players} />
          <PlayersCard players={players} />
        </aside>
      </div>
    </main>
  );
}

/**
 * 未参加ユーザー向けの「参加する」パネル。
 * late entry 締切超過や state ≠ setup/seating/running の場合は通常メッセージのみ表示。
 */
function JoinSelfPanel({
  canJoin,
  joining,
  error,
  onJoin,
}: {
  tid: string;
  canJoin: boolean;
  joining: boolean;
  error: string | null;
  onJoin: () => Promise<void>;
}) {
  if (!canJoin) {
    return <p className="text-sm text-muted-foreground">受付登録されていません</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        まだ参加登録していません。ワンタップで参加できます。
      </p>
      <Button size="sm" onClick={() => void onJoin()} disabled={joining}>
        {joining ? "登録中…" : "参加する"}
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
