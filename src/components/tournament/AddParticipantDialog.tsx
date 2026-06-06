"use client";

import { useEffect, useMemo, useState } from "react";

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
import { DISPLAY_NAME_MAX_LENGTH, type GroupDoc } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";
import {
  addMemberPlayerByOrganizer,
  addNamedOnlyPlayerByOrganizer,
} from "@/lib/services/proxy-receipt";

type Tab = "member" | "name";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tid: string;
  organizerUid: string;
  /** memberUids / memberDisplayNames を使って未追加メンバーを列挙する。 */
  group: GroupDoc;
  /** 既に追加済みの member uid（メンバータブの候補から除外する）。 */
  existingPlayerUids: string[];
}

/**
 * Phase 2 (07-third-dryrun-improvements): 運営者による受付代理ダイアログ。
 *
 *  - メンバータブ: 未追加メンバーをネイティブ `<select>` で選び、
 *    `addMemberPlayerByOrganizer`（uid 紐づけ）で代理 create。
 *  - 名前タブ: 表示名だけ入力し、`addNamedOnlyPlayerByOrganizer`（uid=null）で
 *    運営者管理専用 player を create。
 *  - shadcn Tabs / Radix Select は未導入・jsdom テスト困難のため、手動 `role="tablist"`
 *    （join-client パターン）+ ネイティブ `<select>` を使う。
 *  - 締切超過等の業務エラーは service が AppError を throw し、ダイアログ内に表示する
 *    （UI 側で事前ブロックしない）。
 */
export function AddParticipantDialog({
  open,
  onOpenChange,
  tid,
  organizerUid,
  group,
  existingPlayerUids,
}: Props) {
  const [tab, setTab] = useState<Tab>("member");
  const [selectedUid, setSelectedUid] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 未追加メンバーのみを候補にする。
  const candidates = useMemo(
    () => group.memberUids.filter((uid) => !existingPlayerUids.includes(uid)),
    [group.memberUids, existingPlayerUids],
  );

  // 選択中 uid は候補から都度導出する。realtime 更新で候補が縮小しても常に有効な
  // 値（未選択 / 無効化時は先頭）を指すため、選択状態を effect でリセットしない。
  const selected = candidates.includes(selectedUid) ? selectedUid : candidates[0] ?? "";

  // ダイアログを開いた立ち上がり時のみ state を初期化する（前回入力を引き継がない）。
  //   deps を [open] に限定する: players snapshot 由来の親再 render で `candidates` の
  //   参照が変わるたびに effect が発火し、受付中（同時 join あり）に入力途中のタブ・
  //   表示名が破棄される不具合を防ぐ。
  useEffect(() => {
    if (open) {
      setTab("member");
      setSelectedUid("");
      setDisplayName("");
      setError(null);
    }
  }, [open]);

  function memberDisplayName(uid: string): string {
    // memberDisplayNames は招待コード加入時に ≤15 文字で書かれる前提だが、欠落データ
    // 対策で uid フォールバック時も DISPLAY_NAME_MAX_LENGTH に丸め、service 側
    // parseDisplayName の too-long throw で追加不能になるのを防ぐ。
    return group.memberDisplayNames[uid] ?? uid.slice(0, DISPLAY_NAME_MAX_LENGTH);
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (tab === "member") {
        if (!selected) {
          setSubmitting(false);
          return;
        }
        await addMemberPlayerByOrganizer({
          tid,
          organizerUid,
          memberUid: selected,
          displayName: memberDisplayName(selected),
        });
      } else {
        await addNamedOnlyPlayerByOrganizer({ tid, organizerUid, displayName });
      }
      onOpenChange(false);
    } catch (e) {
      // service 側で warn 済み — UI catch は表示用 message 抽出のみ。
      const wrapped = unwrapOrFrom(e, "firestore/write_failed", "参加者の追加に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(formatErrorForDisplay(wrapped));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>参加者を追加</DialogTitle>
          <DialogDescription>
            運営者が参加者を代理で受付します。
          </DialogDescription>
        </DialogHeader>

        <div role="tablist" aria-label="受付方法" className="flex gap-1 border-b text-sm">
          {(
            [
              ["member", "メンバーから選ぶ"],
              ["name", "ゲストで追加"],
            ] as [Tab, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              id={`ap-tab-${value}`}
              type="button"
              role="tab"
              aria-selected={tab === value}
              aria-controls={`ap-panel-${value}`}
              onClick={() => {
                setTab(value);
                setError(null);
              }}
              className={`border-b-2 px-3 py-2 ${
                tab === value
                  ? "border-primary font-medium"
                  : "border-transparent text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div
            id="ap-panel-member"
            role="tabpanel"
            aria-labelledby="ap-tab-member"
            hidden={tab !== "member"}
            className="space-y-2"
          >
            <Label htmlFor="ap-member">メンバー</Label>
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                追加できるメンバーがいません。
              </p>
            ) : (
              <select
                id="ap-member"
                aria-label="メンバー"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={selected}
                onChange={(e) => setSelectedUid(e.target.value)}
              >
                {candidates.map((uid) => (
                  <option key={uid} value={uid}>
                    {memberDisplayName(uid)}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div
            id="ap-panel-name"
            role="tabpanel"
            aria-labelledby="ap-tab-name"
            hidden={tab !== "name"}
            className="space-y-2"
          >
            <Label htmlFor="ap-name">表示名</Label>
            <Input
              id="ap-name"
              aria-label="表示名"
              // hidden パネル内の required は HTML 制約検証から除外されるため、
              // member タブ submit 時に空名で submit がブロックされることはない。
              required={tab === "name"}
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
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
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              キャンセル
            </Button>
            <Button
              type="submit"
              disabled={submitting || (tab === "member" && candidates.length === 0)}
            >
              {submitting ? "追加中…" : "追加"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
