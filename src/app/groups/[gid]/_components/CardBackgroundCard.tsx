"use client";

import { Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { CardReadabilityPreview } from "@/components/og/CardReadabilityPreview";
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
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import {
  CARD_TEXT_THEMES,
  type CardBackground,
  type CardTextTheme,
  DEFAULT_CARD_BACKGROUND_TEXT_THEME,
} from "@/lib/firebase/schemas/group";
import {
  clearSeasonCardBackground,
  clearWinnerCardBackground,
  updateSeasonCardBackgroundTextTheme,
  updateWinnerCardBackgroundTextTheme,
  uploadAndSetSeasonCardBackground,
  uploadAndSetWinnerCardBackground,
} from "@/lib/services/card-background";
import { resizeImageToCardSize } from "@/lib/utils/image-resize";

/**
 * Phase A.2 (05-post-launch-polish Track A): 結果カード背景画像 inline edit カード（共通基底）。
 *
 *   - winner / season で UI / 状態機械が完全に同じため、`kind` prop で service を分岐
 *   - canEdit=false のときはプレビューと現状のみ表示（ファイル選択 / 保存 / 解除ボタンは出さない）
 *   - 5MB 超 / 非 image-mime は pre-reject して onError に流す
 *   - 1200×630 jpeg 0.8 にクライアントで圧縮してから upload（資料 storage 上限 1MB を確実に下回る）
 *   - 旧 asset 削除は service 層が retry。本カードは upload + Firestore pointer の更新のみ「見届ける」
 */

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set<string>(["image/jpeg", "image/png", "image/webp"]);

const TITLE_BY_KIND: Record<"winner" | "season", string> = {
  winner: "優勝者カード背景画像",
  season: "シーズン戦績カード背景画像",
};

const PLACEHOLDER_BG: Record<"winner" | "season", string> = {
  // OG カードと同系統のプレースホルダ。実 OG_COLORS とは別ピクセルなので軽く再現する。
  winner: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
  season: "linear-gradient(135deg, #1e3a8a 0%, #312e81 100%)",
};

const DEMO_TEXT: Record<
  "winner" | "season",
  { title: string; main: string; sub: string }
> = {
  winner: {
    title: "トーナメント名",
    main: "優勝者名",
    sub: "ALLin-PokerTimer",
  },
  season: {
    title: "SEASON LEADERBOARD",
    main: "1ST",
    sub: "ALLin-PokerTimer",
  },
};

interface Props {
  gid: string;
  kind: "winner" | "season";
  /** 現在の Firestore pointer。null = 未設定。 */
  current: CardBackground;
  /** owner のみ編集可。呼出側でも gate するのが推奨だが、本 component 内でも UI を制限。 */
  canEdit: boolean;
  /** 保存成功時のリロード（親の reload + refreshGroups を再走させる）。 */
  onSaved: () => Promise<void>;
  /** エラー通知（親の setError と接続）。 */
  onError: (message: string) => void;
  /** テスト用 data-testid prefix。 */
  dataTestIdPrefix?: string;
}

export function CardBackgroundCard({
  gid,
  kind,
  current,
  canEdit,
  onSaved,
  onError,
  dataTestIdPrefix,
}: Props) {
  const { user } = useAuthUser();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewContentType, setPreviewContentType] = useState<
    "image/jpeg" | "image/png" | "image/webp"
  >("image/jpeg");
  const [textTheme, setTextTheme] = useState<CardTextTheme>(
    current?.textTheme ?? DEFAULT_CARD_BACKGROUND_TEXT_THEME,
  );
  const [working, setWorking] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  // 親から current が更新されたら、編集中でなければ追従する。
  useEffect(() => {
    if (!working) {
      setTextTheme(current?.textTheme ?? DEFAULT_CARD_BACKGROUND_TEXT_THEME);
    }
  }, [current, working]);

  // ObjectURL リーク防止: 古い URL を revoke するクリーンアップ。
  //   - 依存配列に previewUrl を入れているため、新 URL がセットされると
  //     React が旧値で cleanup を一度呼んでから新 URL で effect を再走させる。
  //   - revoke 経路は本 cleanup の 1 系統に統一する（`setPreviewUrl` updater 側で
  //     重複 revoke しない）。仕様上 no-op だが意図を明示するため。
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const resetSelection = useCallback(() => {
    setPreviewBlob(null);
    setPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      if (!file) return;
      if (file.size > MAX_UPLOAD_BYTES) {
        onError("画像は 5MB 以下を選択してください");
        e.target.value = "";
        return;
      }
      if (!ALLOWED_MIME.has(file.type)) {
        onError("画像形式は jpeg / png / webp を選択してください");
        e.target.value = "";
        return;
      }
      try {
        const blob = await resizeImageToCardSize(file, { mimeType: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        // 旧 previewUrl の revoke は useEffect cleanup に任せる（単一責務）。
        setPreviewUrl(url);
        setPreviewBlob(blob);
        setPreviewContentType("image/jpeg");
      } catch (err) {
        const wrapped = unwrapOrFrom(
          err,
          "image/encode-failed",
          "画像の処理に失敗しました",
        );
        onError(formatErrorForDisplay(wrapped));
        e.target.value = "";
      }
    },
    [onError],
  );

  const onSave = useCallback(async () => {
    if (!user) {
      onError("ログインが必要です");
      return;
    }
    setWorking(true);
    setSavedFlash(false);
    try {
      if (previewBlob) {
        if (kind === "winner") {
          await uploadAndSetWinnerCardBackground({
            gid,
            uid: user.uid,
            blob: previewBlob,
            contentType: previewContentType,
            textTheme,
            previousAssetId: current?.storageAssetId ?? null,
          });
        } else {
          await uploadAndSetSeasonCardBackground({
            gid,
            uid: user.uid,
            blob: previewBlob,
            contentType: previewContentType,
            textTheme,
            previousAssetId: current?.storageAssetId ?? null,
          });
        }
      } else if (current) {
        // 画像差し替えなしで textTheme だけ更新する経路。
        if (kind === "winner") {
          await updateWinnerCardBackgroundTextTheme({
            gid,
            uid: user.uid,
            current,
            textTheme,
          });
        } else {
          await updateSeasonCardBackgroundTextTheme({
            gid,
            uid: user.uid,
            current,
            textTheme,
          });
        }
      } else {
        onError("画像を選択してから保存してください");
        return;
      }
      resetSelection();
      await onSaved();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      const wrapped = unwrapOrFrom(
        e,
        "storage/upload-failed",
        "結果カード背景画像の保存に失敗しました",
      );
      onError(formatErrorForDisplay(wrapped));
    } finally {
      setWorking(false);
    }
  }, [
    user,
    previewBlob,
    previewContentType,
    textTheme,
    current,
    gid,
    kind,
    onSaved,
    onError,
    resetSelection,
  ]);

  const requestClear = useCallback(() => {
    if (!current?.imageUrl) return;
    setClearConfirmOpen(true);
  }, [current]);

  const confirmClear = useCallback(async () => {
    setClearConfirmOpen(false);
    if (!user) {
      onError("ログインが必要です");
      return;
    }
    setWorking(true);
    try {
      if (kind === "winner") {
        await clearWinnerCardBackground({
          gid,
          uid: user.uid,
          previousAssetId: current?.storageAssetId ?? null,
        });
      } else {
        await clearSeasonCardBackground({
          gid,
          uid: user.uid,
          previousAssetId: current?.storageAssetId ?? null,
        });
      }
      resetSelection();
      await onSaved();
    } catch (e) {
      const wrapped = unwrapOrFrom(
        e,
        "firestore/write_failed",
        "背景画像の解除に失敗しました",
      );
      onError(formatErrorForDisplay(wrapped));
    } finally {
      setWorking(false);
    }
  }, [user, current, gid, kind, onSaved, onError, resetSelection]);

  const displayImageUrl = previewUrl ?? current?.imageUrl ?? null;
  const themeChanged = current?.textTheme !== textTheme;
  const canSaveTheme = !!current && current.imageUrl != null && themeChanged;
  const canSaveUpload = !!previewBlob;
  const busy = working || clearConfirmOpen;
  const saveDisabled = busy || (!canSaveTheme && !canSaveUpload);

  return (
    <Card aria-label={`${kind}-card-background-card`}>
      <CardHeader>
        <CardTitle>{TITLE_BY_KIND[kind]}</CardTitle>
        <CardDescription>
          {kind === "winner"
            ? "トーナメント終了時の優勝者カード PNG に表示される背景画像です。"
            : "シーズン首位カード PNG に表示される背景画像です。"}
          公開リンクから誰でも閲覧可能になります。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <CardReadabilityPreview
          imageUrl={displayImageUrl}
          textTheme={textTheme}
          variant={kind}
          placeholderBg={PLACEHOLDER_BG[kind]}
          demo={DEMO_TEXT[kind]}
          ariaLabel={`${kind}-card-background-preview`}
          testId={dataTestIdPrefix ? `${dataTestIdPrefix}-preview` : undefined}
        />

        {canEdit ? (
          <>
            <fieldset className="space-y-2 text-sm">
              <legend className="font-medium">テキストテーマ</legend>
              <div className="flex gap-3">
                {CARD_TEXT_THEMES.map((t) => (
                  <label key={t} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name={`${kind}-text-theme`}
                      value={t}
                      checked={textTheme === t}
                      onChange={() => setTextTheme(t)}
                      disabled={busy}
                    />
                    <span>{t === "light" ? "ライト" : "ダーク"}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                明るい背景には「ライト」、暗い背景には「ダーク」を選んでください。
              </p>
            </fieldset>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => void onFileChange(e)}
              data-testid={
                dataTestIdPrefix ? `${dataTestIdPrefix}-file-input` : undefined
              }
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid={
                    dataTestIdPrefix ? `${dataTestIdPrefix}-pick` : undefined
                  }
                >
                  <Upload aria-hidden />
                  ファイルを選択
                </Button>
                {current?.imageUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={requestClear}
                    data-testid={
                      dataTestIdPrefix ? `${dataTestIdPrefix}-clear` : undefined
                    }
                  >
                    <Trash2 aria-hidden />
                    背景を解除
                  </Button>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  jpeg / png / webp（5MB 以下）
                </span>
              </div>
              <div className="flex items-center gap-2">
                {savedFlash ? (
                  <span className="text-sm text-emerald-700" role="status">
                    保存しました
                  </span>
                ) : null}
                <Button
                  type="button"
                  onClick={() => void onSave()}
                  disabled={saveDisabled}
                  data-testid={
                    dataTestIdPrefix ? `${dataTestIdPrefix}-save` : undefined
                  }
                >
                  {working ? "保存中…" : "保存"}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            背景画像はオーナーのみ変更できます。
          </p>
        )}
      </CardContent>

      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>背景画像を解除</DialogTitle>
            <DialogDescription>
              現在設定されている背景画像を解除します。解除後は固定グラデーション背景に戻ります。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setClearConfirmOpen(false)}
              disabled={working}
            >
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmClear()}
              disabled={working}
            >
              背景を解除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
