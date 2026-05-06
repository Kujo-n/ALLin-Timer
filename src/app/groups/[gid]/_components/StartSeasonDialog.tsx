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
 * Phase A: 「シーズンを開始する」操作の確認モーダル。
 *
 * 現在 stats を `seasonHistory` に snapshot した上で、新シーズンに切り替える
 * 取り消し不可の操作のため、明示的な意思確認を取る（LeaveDeleteDialogs と同形）。
 */
export function StartSeasonDialog({
  open,
  onOpenChange,
  onConfirm,
  working,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onConfirm: () => void;
  working: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>シーズンを開始しますか？</DialogTitle>
          <DialogDescription>
            現在の戦績は履歴にスナップショットされ、新しいシーズンが開始されます。
            この操作は取り消せません。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={working}
          >
            キャンセル
          </Button>
          <Button onClick={onConfirm} disabled={working}>
            {working ? "開始中…" : "開始する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
