"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatErrorForDisplay, unwrapOrFrom } from "@/lib/errors";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import { updatePlayerDisplayNameByOrganizer } from "@/lib/services/proxy-receipt";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tid: string;
  organizerUid: string;
  /** 編集対象の player（名前のみ・uid=null 想定）。null のときダイアログは閉じている。 */
  target: PlayerDoc | null;
}

/**
 * Phase 2 (07-third-dryrun-improvements): 名前のみ（uid=null）player の表示名を運営者が
 * 修正するダイアログ。PlayerList から抽出（architect-refactor 20260606 / finding-3）。
 *
 *  - editName / editError / editSaving の状態はこのダイアログ内に閉じる。
 *  - target が変わる（= ダイアログを開く）たびに入力欄を target.displayName で初期化する。
 *  - service エラーは role=alert で表示し、ダイアログは閉じない（入力修正を促す）。
 */
export function EditPlayerNameDialog({ open, onOpenChange, tid, organizerUid, target }: Props) {
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // ダイアログを開いた立ち上がり時に target の現在名で初期化する（前回入力を引き継がない）。
  useEffect(() => {
    if (open && target) {
      setEditName(target.displayName);
      setEditError(null);
    }
  }, [open, target]);

  async function onConfirmEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await updatePlayerDisplayNameByOrganizer({
        tid,
        organizerUid,
        pid: target.id,
        displayName: editName,
      });
      onOpenChange(false);
    } catch (e) {
      // service 側で warn 済み — UI catch は表示用 message 抽出のみ
      const wrapped = unwrapOrFrom(e, "firestore/write_failed", "表示名の更新に失敗しました");
      setEditError(formatErrorForDisplay(wrapped));
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>表示名を変更</DialogTitle>
          <DialogDescription>名前のみの参加者の表示名を修正します。</DialogDescription>
        </DialogHeader>
        <form onSubmit={onConfirmEdit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-player-name">表示名</Label>
            <Input
              id="edit-player-name"
              aria-label="表示名"
              required
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>
          {editError ? (
            <p className="text-sm text-destructive" role="alert">
              {editError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={editSaving}
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={editSaving}>
              {editSaving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
