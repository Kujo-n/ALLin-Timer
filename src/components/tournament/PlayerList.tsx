"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { AddParticipantDialog } from "@/components/tournament/AddParticipantDialog";
import { BustButton } from "@/components/tournament/BustButton";
import { EditPlayerNameDialog } from "@/components/tournament/EditPlayerNameDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatErrorForDisplay, unwrapOrFrom } from "@/lib/errors";
import type { GroupDoc } from "@/lib/firebase/schemas/group";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentState } from "@/lib/firebase/schemas/tournament";
import { cancelPlayerEntry } from "@/lib/services/receipt";
import { getSameTableActivePdOtherIds } from "@/lib/services/seating/same-table";

interface Props {
  tid: string;
  /** subscribePlayers の結果（dashboard で 1 度だけ subscribe して伝搬する）。 */
  players: PlayerDoc[];
  /** subscribe error（dashboard 側で受け取って表示するため optional に伝搬）。 */
  subscribeError?: string | null;
  /** true の場合、各プレイヤー行に「取消」ボタンを出す（運営者向け） */
  canManage?: boolean;
  /** バストボタン表示判定用。running / paused のみで出す。 */
  tournamentState: TournamentState;
  /**
   * Phase 5.1: setup 時のみ表示する PD（プレイングディーラー）チェックボックス。
   * canManage=true かつ tournamentState="setup" のときのみ render する。
   * 値変化時にトグル処理を呼ぶ。
   */
  onTogglePd?: (player: PlayerDoc, value: boolean) => Promise<void>;
  /**
   * Phase 2 (07-third-dryrun-improvements): 受付代理ダイアログ用。
   * canManage かつ canAddParticipant かつ group / organizerUid が揃うとき
   * 「参加者を追加」ボタンと名前のみ player の表示名編集を出す。
   */
  group?: GroupDoc | null;
  organizerUid?: string | null;
  /** 受付可能 state か（dashboard が isAcceptingProxyEntry(data) を渡す）。 */
  canAddParticipant?: boolean;
}

export function PlayerList({
  tid,
  players,
  subscribeError,
  canManage = false,
  tournamentState,
  onTogglePd,
  group,
  organizerUid,
  canAddParticipant = false,
}: Props) {
  // M3 fix: subscribeError を useEffect 経由で local state にコピーしない。
  // 取消エラーのみ local state で持ち、subscribe error は render 時に合成。
  const [localError, setLocalError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PlayerDoc | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PlayerDoc | null>(null);
  const error = subscribeError ?? localError;

  async function onConfirmCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await cancelPlayerEntry(tid, cancelTarget.id);
      setCancelTarget(null);
    } catch (e) {
      // service 側で warn 済み — UI catch は表示用 message 抽出のみ
      const wrapped = unwrapOrFrom(e, "firestore/write_failed", "取消に失敗しました");
      setLocalError(formatErrorForDisplay(wrapped));
    } finally {
      setCancelling(false);
    }
  }

  // 代理受付ダイアログを出せるか（受付可能 state + organizer 文脈が揃う）。
  const showAddParticipant =
    canManage && canAddParticipant && !!group && !!organizerUid;

  const showBustButton =
    canManage && (tournamentState === "running" || tournamentState === "paused");
  // Phase 5.1: setup 中のみ PD チェックボックスを PlayerList に表示。
  // seating 以降は SeatingBoard 側を真実源にして checkbox 重複表示を防ぐ。
  const showPdCheckbox =
    canManage && tournamentState === "setup" && !!onTogglePd;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>参加者 ({players.length})</CardTitle>
            <CardDescription>リアルタイム同期中。</CardDescription>
          </div>
          {showAddParticipant ? (
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              参加者を追加
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : players.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            まだ参加者がいません。受付 URL を共有してください。
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {players.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <span className="flex-1 truncate">{p.displayName}</span>
                {p.uid === null ? (
                  <span className="ml-1 inline-flex flex-shrink-0 items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    管理専用
                  </span>
                ) : null}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {p.isBusted
                      ? "脱落"
                      : p.tableNum !== null && p.seatNum !== null
                        ? `Table:${p.tableNum}, No.${p.seatNum}`
                        : "エントリー中"}
                  </span>
                  {showPdCheckbox && !p.isBusted ? (
                    <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={p.isPlayingDealer}
                        onChange={(e) => {
                          void onTogglePd!(p, e.target.checked).catch((err) => {
                            // orchestrator 側で warn 済み — UI catch は表示用 message 抽出のみ
                            const wrapped = unwrapOrFrom(
                              err,
                              "firestore/write_failed",
                              "PD 設定に失敗しました",
                            );
                            setLocalError(formatErrorForDisplay(wrapped));
                          });
                        }}
                        aria-label={`pd-${p.displayName}`}
                      />
                      <span>PD</span>
                    </label>
                  ) : null}
                  {showBustButton ? (
                    <BustButton
                      tid={tid}
                      pid={p.id}
                      isBusted={p.isBusted}
                      // 同卓 1 PD 制約のため、bust 時に OFF を伝播すべき相手は同卓 PD だけ。
                      // 全員に書込んでも冪等だが、9 席満卓で 8 件の余計な write が出るので
                      // 最大 1 件に絞る（同卓 PD 不在なら空配列）。
                      sameTablePlayerIds={getSameTableActivePdOtherIds(p, players)}
                      onError={setLocalError}
                    />
                  ) : null}
                  {canManage && p.uid === null && organizerUid ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${p.displayName} の表示名を編集`}
                      onClick={() => setEditTarget(p)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`cancel-${p.displayName}`}
                      onClick={() => setCancelTarget(p)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>エントリーを取り消す</DialogTitle>
            <DialogDescription>
              「{cancelTarget?.displayName}」の参加を取り消します。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void onConfirmCancel();
              }}
              disabled={cancelling}
            >
              {cancelling ? "処理中…" : "取消"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showAddParticipant ? (
        <AddParticipantDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          tid={tid}
          organizerUid={organizerUid}
          group={group}
          existingPlayerUids={players
            .filter((p) => p.uid !== null)
            .map((p) => p.uid as string)}
        />
      ) : null}

      {organizerUid ? (
        <EditPlayerNameDialog
          open={editTarget !== null}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          tid={tid}
          organizerUid={organizerUid}
          target={editTarget}
        />
      ) : null}
    </Card>
  );
}
