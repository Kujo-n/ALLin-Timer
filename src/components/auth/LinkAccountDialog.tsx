"use client";

import type { AuthCredential } from "firebase/auth";
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
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { linkGoogleWithPassword } from "@/lib/services/auth-actions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  pendingCredential: AuthCredential;
  /** 連携成功後のフォローアップ処理。Promise を返した場合は完了を待ってからダイアログを閉じる。 */
  onLinked: () => void | Promise<void>;
}

export function LinkAccountDialog({
  open,
  onOpenChange,
  email,
  pendingCredential,
  onLinked,
}: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await linkGoogleWithPassword(email, password, pendingCredential);
      // onLinked が async な場合は後続処理（例: join 継続）の完了までダイアログを残す
      await Promise.resolve(onLinked());
      onOpenChange(false);
    } catch (e) {
      const wrapped = AppError.from(e, "auth/link-failed", "連携に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Google アカウントを連携</DialogTitle>
          <DialogDescription>
            <strong>{email}</strong> は既にパスワードで登録されています。
            パスワードを入力して連携すると、次回以降は Google / パスワードどちらでもログインできるようになります。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="link-password">パスワード</Label>
            <Input
              id="link-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "連携中…" : "連携する"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
