"use client";

import { useEffect, useState } from "react";

import { ThemedQRCode } from "@/components/qr/ThemedQRCode";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatErrorForDisplay, unwrapOrFrom } from "@/lib/errors";
import { useClipboardCopy } from "@/lib/hooks/useClipboardCopy";
import { buildSpectateUrl } from "@/lib/services/qr";
import { setSpectateEnabled } from "@/lib/services/tournament";

interface SpectateModeCardProps {
  /** 対象トーナメント id（URL 構築 + 書込先）。 */
  tid: string;
  /** 現在の `tournament.spectateEnabled` 値。toggle UI の checked 制御に使う。 */
  enabled: boolean;
  /** 現在のユーザー uid。書込時の role check に使う。 */
  uid: string;
  /** 上位の error 表示と接続する callback（dashboard-client.tsx の setError）。 */
  onError: (message: string) => void;
}

/**
 * Phase 3 (04-spectate-mode): 観戦モード toggle / URL 共有 / QR 表示の運営者用カード。
 *
 *   - role gate は呼出側 (`dashboard-client.tsx`) で organizer-only に絞る（dashboard
 *     自体が member を /live に redirect する）。本 card は防御として render されたら
 *     描画する設計（component 単体では role を検査しない。最終ラインは Firestore Rules）。
 *   - toggle ON 時のみ確認 dialog を挟む（OFF にする方向は誤公開リスクが減る方向のため即時）。
 *   - 書込中（toggling=true）は toggle / 確認ボタンを disabled にして二重 click を防ぐ。
 *   - 同期は dashboard 側の useTournamentTimer (subscribeTournament) で onSnapshot 経由。
 *     本 card 内で最新値を fetch しない（props.enabled が真実源）。
 *   - QR はデフォルト折りたたみ（showQr=false）。ON 時に「QR を表示」ボタンで開閉。
 */
export function SpectateModeCard({
  tid,
  enabled,
  uid,
  onError,
}: SpectateModeCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const { copied, copy } = useClipboardCopy(url, { onError });

  // SSR では `window.location.origin` が undefined。クライアント hydrate 後に確定する。
  useEffect(() => {
    setUrl(buildSpectateUrl(tid));
  }, [tid]);

  function onToggleClick() {
    if (toggling) return;
    if (enabled) {
      // OFF にする方向は確認なしで即時。
      void apply(false);
    } else {
      // ON にする方向は確認 dialog を挟む（誤公開防止）。
      setConfirmOpen(true);
    }
  }

  async function apply(next: boolean) {
    setToggling(true);
    try {
      await setSpectateEnabled({ tid, uid, value: next });
      // 成功時の onSnapshot 反映は呼出側で済む。ここでは dialog を閉じるだけ。
      setConfirmOpen(false);
    } catch (e) {
      const wrapped = unwrapOrFrom(
        e,
        "firestore/write_failed",
        "観戦モード設定の更新に失敗しました",
      );
      onError(formatErrorForDisplay(wrapped));
      // dialog は閉じない（再試行可能な状態を残す）。
    } finally {
      setToggling(false);
    }
  }

  return (
    <Card aria-label="spectate-mode-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>観戦モード</CardTitle>
            <CardDescription>
              URL を知る人は誰でも、ログイン無しでタイマー・席表・残人数を閲覧できます。
              メールアドレスや過去の戦績は公開されません。
            </CardDescription>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <input
              type="checkbox"
              role="switch"
              aria-label="観戦モードを切り替え"
              checked={enabled}
              disabled={toggling}
              onChange={onToggleClick}
            />
            <span aria-hidden>{enabled ? "ON" : "OFF"}</span>
          </label>
        </div>
      </CardHeader>
      {enabled && url ? (
        <CardContent className="space-y-3">
          <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
            {url}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copy()}
              aria-label="観戦 URL をコピー"
            >
              {copied ? "コピーしました" : "URL をコピー"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowQr((v) => !v)}
              aria-label={showQr ? "QR コードを隠す" : "QR コードを表示"}
            >
              {showQr ? "QR を隠す" : "QR を表示"}
            </Button>
          </div>
          {showQr ? (
            // Track D Phase D.2: ThemedQRCode が resolvedTheme に応じて fg/bg を切替える。
            <div className="flex justify-center rounded-md border bg-card p-4">
              <ThemedQRCode
                value={url}
                size={224}
                aria-label="観戦 URL の QR コード"
              />
            </div>
          ) : null}
        </CardContent>
      ) : null}

      {/* OFF → ON への遷移時のみ確認 dialog を挟む。 */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (toggling) return;
          setConfirmOpen(o);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>観戦モードを ON にしますか？</DialogTitle>
            <DialogDescription>
              URL
              を知る人は誰でも、ログイン無しでタイマー・席表・残人数・displayName
              を閲覧できるようになります。メールアドレスや過去の対戦履歴は公開されません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={toggling}
            >
              キャンセル
            </Button>
            <Button onClick={() => void apply(true)} disabled={toggling}>
              {toggling ? "設定中…" : "ON にする"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
