"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Phase 4 (08-auto-group-join-on-entry): メンバー除外の確認モーダル。
 *
 * `targetName` が非 null のときだけ open になる（親は「対象行」を state に持つ）。
 * 除外は取り消せない破壊的操作のため、対象名とサークル名を明示して意思確認を取る
 * （`LeaveDeleteDialogs` / `StartSeasonDialog` と同形）。
 */
export function RemoveMemberDialog({
  targetName,
  groupName,
  onOpenChange,
  onConfirm,
  working,
}: {
  /** 除外対象の表示名。null のとき dialog は閉じている。 */
  targetName: string | null;
  groupName: string;
  onOpenChange: (next: boolean) => void;
  onConfirm: () => void;
  working: boolean;
}) {
  return (
    <Dialog open={targetName !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>メンバーを除外</DialogTitle>
          <DialogDescription>
            「{targetName}」を「{groupName}」から除外します。
            除外されたメンバーはこのサークルのトーナメント／ストラクチャを閲覧できなくなります。
            過去のトーナメントの参加記録とシーズン戦績はそのまま残ります。
            再び参加してもらう場合は、招待リンクを渡すか、トーナメント受付をしてもらってください。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working}>
            キャンセル
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={working}>
            {working ? "除外中…" : "除外する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
