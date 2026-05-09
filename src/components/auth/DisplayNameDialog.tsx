"use client";

import { useState } from "react";

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
import { AppError, formatErrorForDisplay } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";
import { updateDisplayName } from "@/lib/services/auth-actions";

interface Props {
  /** dialog 表示制御。`onDone` 以外の経路では閉じられない（必須ダイアログ）。 */
  open: boolean;
  /** 保存成功時のみ呼ばれる。親側で dialog close + redirect を行う。 */
  onDone: () => void;
  /** 入力欄の初期値（Google の本名を避けたい場合は空で渡すことを推奨）。 */
  initialName?: string;
}

/**
 * Phase 4.7: Google 新規ログイン直後に displayName を必須入力させるダイアログ。
 * `onOpenChange` を渡さず backdrop / Escape で閉じられないようにしている。
 * 保存成功時に refreshUser() を呼んでヘッダを即更新する。
 */
export function DisplayNameDialog({ open, onDone, initialName = "" }: Props) {
  const { refreshUser } = useAuthUser();
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await updateDisplayName(name);
      refreshUser();
      onDone();
    } catch (e) {
      const wrapped = AppError.from(e, "auth/unknown", "保存に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(formatErrorForDisplay(wrapped));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>表示名を設定</DialogTitle>
          <DialogDescription>
            サークルで使うニックネームを入力してください。後から /settings でも変更できます。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSave} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dn">表示名</Label>
            <Input
              id="dn"
              required
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {DISPLAY_NAME_MAX_LENGTH} 文字以内で入力してください。
            </p>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
