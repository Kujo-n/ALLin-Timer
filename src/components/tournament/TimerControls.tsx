"use client";

import { Maximize, Minimize, Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";
import { useState } from "react";

import { ConnectionBadge } from "@/components/tournament/ConnectionBadge";
import { SoundToggleButton } from "@/components/tournament/SoundToggleButton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppError } from "@/lib/errors";
import {
  advanceLevel,
  confirmSeating,
  finishTournament,
  pauseTournament,
  resumeTournament,
  revertLevel,
} from "@/lib/firebase/repositories/tournaments";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";
import { joinAsCurrentUser } from "@/lib/services/receipt";
import { commitInitialSeating } from "@/lib/services/seating/orchestrator";

interface Props {
  tid: string;
  uid: string;
  userGroupIds: string[];
  tournament: TournamentDoc;
  /** 受付済み参加者一覧（subscribePlayers の結果）。setup→seating の commitInitialSeating に渡す。 */
  players: PlayerDoc[];
  /**
   * サウンドトグルを表示するための props。tournamentGroup が確定している運営者ロールでのみ
   * 渡す。undefined のとき running/paused 用ボタン群にサウンドアイコンは出さない。
   * Phase 4.13: settingsHref を廃止し、enabled 反転を直接 group に書込む onToggleEnabled に変更。
   * 詳細設定はサイドバーの「サウンド設定」から行う。
   */
  audio?: {
    enabled: boolean;
    unlocked: boolean;
    onUnlock: () => Promise<void>;
    onToggleEnabled: (next: boolean) => Promise<void>;
  };
  /**
   * Phase 4.14 追加要望: 全画面表示トグルをサウンドアイコンの左横に配置するため、
   * dashboard が保持する fullscreen 状態をアイコン化して持ち込む。undefined の場合は
   * 表示しない（/live など fullscreen ボタンを出さないコンテキスト用）。
   */
  fullscreen?: {
    isFullscreen: boolean;
    onToggle: () => void;
  };
  /**
   * Phase 4.14 追加要望: 「同期中」ConnectionBadge を全画面アイコンの左に配置する。
   * undefined の場合は表示しない。
   */
  connection?: {
    fromCache: boolean;
    lastSyncAt: number | null;
  };
  onError?: (message: string) => void;
}

type Op =
  | "commit-seating"
  | "confirm-seating"
  | "self-join"
  | "pause"
  | "resume"
  | "advance"
  | "revert"
  | "finish";

export function TimerControls({
  tid,
  uid,
  userGroupIds,
  tournament,
  players,
  audio,
  fullscreen,
  connection,
  onError,
}: Props) {
  const [busy, setBusy] = useState<Op | null>(null);
  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false);

  async function run(op: Op, fn: () => Promise<void>, errMsg: string) {
    if (busy !== null) return;
    setBusy(op);
    try {
      await fn();
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", errMsg);
      logger.warn(wrapped.message, { code: wrapped.code, tid, op });
      onError?.(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setBusy(null);
    }
  }

  const isLast = tournament.currentLevel >= tournament.structureSnapshot.levels.length;
  const isFirst = tournament.currentLevel <= 1;

  // 共通: 全画面表示トグル（アイコンのみ）。
  //   各 state のボタン群の先頭に置くことで、running/paused のサウンドアイコン左に
  //   並ぶレイアウトを実現する。fullscreen prop が未指定なら描画しない。
  const fullscreenButton = fullscreen ? (
    <Button
      variant="outline"
      className="h-10 w-10 p-0"
      aria-label={fullscreen.isFullscreen ? "全画面表示を解除" : "全画面表示"}
      onClick={fullscreen.onToggle}
    >
      {fullscreen.isFullscreen ? (
        <Minimize aria-hidden className="h-5 w-5" />
      ) : (
        <Maximize aria-hidden className="h-5 w-5" />
      )}
    </Button>
  ) : null;

  // 共通: 「同期中」バッジ。fullscreen ボタンの左に並べるため、各 state の先頭に
  // fullscreenButton より前に挿入する。connection 未指定の場合は表示しない。
  // running/paused では「再生アイコンをタイマー中央に揃える」ため横幅を抑える 2 行
  // (stacked) レイアウトに切り替える。
  const connectionBadge = connection ? (
    <ConnectionBadge
      fromCache={connection.fromCache}
      lastSyncAt={connection.lastSyncAt}
      layout="stacked"
    />
  ) : null;

  if (tournament.state === "setup") {
    const activeCount = players.filter((p) => !p.isBusted).length;
    const alreadyJoined = players.some((p) => p.uid === uid);
    return (
      <div className="flex flex-wrap items-center justify-center gap-2">
        {connectionBadge}
        {fullscreenButton}
        <Button
          size="sm"
          disabled={busy !== null || activeCount === 0}
          onClick={() =>
            void run(
              "commit-seating",
              async () => {
                const seed = Date.now();
                await commitInitialSeating(tid, uid, userGroupIds, players, seed);
              },
              "席決めに失敗",
            )
          }
        >
          {busy === "commit-seating" ? "配席中…" : "席を決定"}
        </Button>
        {!alreadyJoined ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void run(
                "self-join",
                async () => {
                  await joinAsCurrentUser({ tid });
                },
                "自己参加に失敗",
              )
            }
          >
            {busy === "self-join" ? "登録中…" : "自分も参加する"}
          </Button>
        ) : null}
        {activeCount === 0 ? (
          <span className="text-xs text-muted-foreground">参加者がいません</span>
        ) : null}
      </div>
    );
  }

  if (tournament.state === "seating") {
    const activeCount = players.filter((p) => !p.isBusted).length;
    return (
      <div className="flex flex-wrap items-center justify-center gap-2">
        {connectionBadge}
        {fullscreenButton}
        <Button
          size="sm"
          disabled={busy !== null || activeCount === 0}
          onClick={() =>
            void run(
              "confirm-seating",
              () => confirmSeating(tid, uid, userGroupIds),
              "トーナメント開始失敗",
            )
          }
        >
          {busy === "confirm-seating" ? "開始中…" : "トーナメント開始"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() =>
            void run(
              "commit-seating",
              async () => {
                const seed = Date.now();
                await commitInitialSeating(tid, uid, userGroupIds, players, seed);
              },
              "再配席に失敗",
            )
          }
        >
          {busy === "commit-seating" ? "再配席中…" : "席を再決定"}
        </Button>
      </div>
    );
  }

  if (tournament.state === "finished") {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2">
        {connectionBadge}
        {fullscreenButton}
        <Button size="sm" disabled>
          終了済み
        </Button>
      </div>
    );
  }

  // running / paused
  // Phase 4.14 追加要望（Phase 4.18 で layout を再構築）:
  //   - 再生 / 一時停止アイコンを TimerDisplay の中央と水平に揃える。中央群
  //     [サウンド, 前, 再生/停止, 次, 終了] を内側 flex で `justify-center` 配置し、
  //     再生アイコン（5 つの中央 = 3 つ目）が視覚中心に来る。
  //   - sm+ では外側を `[1fr_auto_1fr]` の grid とし、左 1fr に全画面アイコン /
  //     中 auto に中央群 / 右 1fr に同期中バッジを並べる。auto 列が左右対称な 1fr に
  //     挟まれるため、全画面 / バッジの有無に依らず再生/停止が grid 全体の中心に揃う。
  //   - 旧実装は `sm:absolute sm:left-0 / sm:right-0` だったが、dashboard の中央列幅
  //     (約 512px) では同期中バッジが「終了」ボタンの上に重なり click を intercept する
  //     リグレッションが発生していた（E2E timer-control-polish / dashboard-polish が fail）。
  //     grid に切替えて空間配分で重なりを排除する。
  //   - 狭幅 (<sm) は外側 flex flex-wrap で各群が折り返す。中央群内部も flex-wrap。
  // ボタンはアイコン表示（aria-label でラベルを補完）。横方向は gap-10 (40px) の
  // 間隔で誤タップを防ぐ。縦方向（折り返し時）は gap-y-3 で詰める。
  const iconBtnCls = "h-10 w-10 p-0";
  const isRunning = tournament.state === "running";
  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-3">
        {fullscreenButton ? (
          <div className="flex items-center sm:justify-self-start">
            {fullscreenButton}
          </div>
        ) : (
          <div className="hidden sm:block" aria-hidden="true" />
        )}

        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
          {audio ? (
            <SoundToggleButton
              enabled={audio.enabled}
              unlocked={audio.unlocked}
              onUnlock={audio.onUnlock}
              onToggleEnabled={audio.onToggleEnabled}
            />
          ) : null}

          <Button
            variant="outline"
            className={iconBtnCls}
            aria-label="前レベル"
            disabled={busy !== null || isFirst}
            onClick={() =>
              void run("revert", () => revertLevel(tid, uid, userGroupIds), "巻き戻し失敗")
            }
          >
            <SkipBack aria-hidden className="h-5 w-5" />
          </Button>

          {isRunning ? (
            <Button
              variant="secondary"
              className={iconBtnCls}
              aria-label="一時停止"
              disabled={busy !== null}
              onClick={() =>
                void run("pause", () => pauseTournament(tid, uid, userGroupIds), "一時停止失敗")
              }
            >
              <Pause aria-hidden className="h-5 w-5" />
            </Button>
          ) : (
            <Button
              className={iconBtnCls}
              aria-label="再開"
              disabled={busy !== null}
              onClick={() =>
                void run("resume", () => resumeTournament(tid, uid, userGroupIds), "再開失敗")
              }
            >
              <Play aria-hidden className="h-5 w-5" />
            </Button>
          )}

          <Button
            variant="outline"
            className={iconBtnCls}
            aria-label="次レベル"
            disabled={busy !== null || isLast}
            onClick={() => void run("advance", () => advanceLevel(tid, uid, userGroupIds), "進行失敗")}
          >
            <SkipForward aria-hidden className="h-5 w-5" />
          </Button>

          <Button
            variant="destructive"
            className={iconBtnCls}
            aria-label="終了"
            disabled={busy !== null}
            onClick={() => setFinishConfirmOpen(true)}
          >
            <Square aria-hidden className="h-5 w-5" />
          </Button>
        </div>

        {connectionBadge ? (
          <div className="flex items-center sm:justify-self-end">
            {connectionBadge}
          </div>
        ) : (
          <div className="hidden sm:block" aria-hidden="true" />
        )}
      </div>

      <Dialog open={finishConfirmOpen} onOpenChange={setFinishConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>トーナメントを終了</DialogTitle>
            <DialogDescription>
              「{tournament.name}」を終了します。終了後はタイマーが停止し、再開できません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFinishConfirmOpen(false)}
              disabled={busy === "finish"}
            >
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setFinishConfirmOpen(false);
                void run("finish", () => finishTournament(tid, uid, userGroupIds), "終了失敗");
              }}
              disabled={busy === "finish"}
            >
              {busy === "finish" ? "処理中…" : "終了する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
