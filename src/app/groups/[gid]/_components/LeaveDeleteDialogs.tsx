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

interface LeaveDeleteDialogsProps {
  /** group 名（dialog の本文に表示）。 */
  groupName: string;
  /** 脱退 confirm dialog の open state。 */
  confirmLeaveOpen: boolean;
  setConfirmLeaveOpen: (open: boolean) => void;
  /** 削除 confirm dialog の open state。 */
  confirmDeleteOpen: boolean;
  setConfirmDeleteOpen: (open: boolean) => void;
  /** ユーザーが「脱退する」を押したときの実処理。 */
  onLeave: () => void;
  /** ユーザーが「削除する」を押したときの実処理。 */
  onDelete: () => void;
  /** 親コンポーネントの「他の操作中」フラグ。 */
  working: boolean;
}

/**
 * サークル詳細画面の脱退 / 削除 confirm dialog 群。
 *
 * Phase 4 architect-refactor (P5-1) で `group-detail-client.tsx` から分離。
 * dialog 自体は Radix Portal で body 直下に描画されるため、render 位置は
 * レイアウト的に重要ではない（親 component の最後にまとめて置く）。
 */
export function LeaveDeleteDialogs({
  groupName,
  confirmLeaveOpen,
  setConfirmLeaveOpen,
  confirmDeleteOpen,
  setConfirmDeleteOpen,
  onLeave,
  onDelete,
  working,
}: LeaveDeleteDialogsProps) {
  return (
    <>
      <Dialog open={confirmLeaveOpen} onOpenChange={setConfirmLeaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>サークルを脱退</DialogTitle>
            <DialogDescription>
              「{groupName}」から脱退します。脱退後はストラクチャ／トーナメントが見えなくなります。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLeaveOpen(false)} disabled={working}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={onLeave} disabled={working}>
              脱退する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>サークルを削除</DialogTitle>
            <DialogDescription>
              「{groupName}」を削除します。配下のストラクチャ／トーナメントは
              <strong>削除されません</strong>が、誰からも見えなくなります。 先に /structures や
              /tournaments で配下データを削除しておくことを推奨します。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={working}
            >
              キャンセル
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={working}>
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
