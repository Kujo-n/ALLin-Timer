"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GroupDoc, MemberRole } from "@/lib/firebase/schemas/group";

function roleLabel(role: MemberRole): string {
  if (role === "owner") return "オーナー";
  if (role === "organizer") return "運営";
  return "一般";
}

interface GroupHeaderCardProps {
  group: GroupDoc;
  /** ログイン中ユーザーの role（自身が member でない場合は null）。 */
  myRole: MemberRole | null;
  isOwner: boolean;
  isOrganizer: boolean;
  /** 親の「他の操作中」フラグ。 */
  working: boolean;
  /** rename 確定処理（owner のみ）。AppError throw を期待する。 */
  onRename: (next: string) => Promise<void>;
  /** 「削除」ボタン click（owner）。 */
  onRequestDelete: () => void;
  /** 「脱退」ボタン click（非 owner）。 */
  onRequestLeave: () => void;
  /** rename 失敗時のエラー通知。 */
  onError: (message: string) => void;
}

/**
 * サークル詳細画面のヘッダ — group 名 + rename inline edit + ナビ/削除/脱退ボタン。
 *
 * Phase 4 architect-refactor (P5-1) で `group-detail-client.tsx` から分離。
 * `useInlineNumberEdit` 相当の string 版が必要なため、本 component 内に小さな state
 * machine を内蔵する（数値 hook の汎用化は scope 外）。
 */
export function GroupHeaderCard({
  group,
  myRole,
  isOwner,
  isOrganizer,
  working,
  onRename,
  onRequestDelete,
  onRequestLeave,
  onError,
}: GroupHeaderCardProps) {
  const [editing, setEditing] = useState(false);
  const [renameValue, setRenameValue] = useState(group.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // group 名が外側で変化した（reload 等）かつ編集中でなければ追従。
  useEffect(() => {
    if (!editing) setRenameValue(group.name);
  }, [group.name, editing]);

  function startEditing(): void {
    setRenameValue(group.name);
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  function cancelEditing(): void {
    setEditing(false);
    setRenameValue(group.name);
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const next = renameValue.trim();
    if (next === "" || next === group.name) {
      cancelEditing();
      return;
    }
    try {
      await onRename(next);
      setEditing(false);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "group/rename-failed";
      const message = err instanceof Error ? err.message : "サークル名の更新に失敗しました";
      onError(`${code}: ${message}`);
    }
  }

  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        {isOwner && editing ? (
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEditing();
                }
              }}
              aria-label="サークル名"
              maxLength={60}
              required
              disabled={working}
              className="h-10 text-2xl font-bold"
            />
            <Button type="submit" size="sm" disabled={working}>
              {working ? "保存中…" : "保存"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={cancelEditing}
              disabled={working}
            >
              キャンセル
            </Button>
          </form>
        ) : isOwner ? (
          <button
            type="button"
            onClick={startEditing}
            aria-label={`サークル名「${group.name}」を編集`}
            className="group inline-flex items-center gap-2 rounded-md text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <h1 className="text-2xl font-bold">{group.name}</h1>
            <Pencil
              className="h-4 w-4 text-muted-foreground transition group-hover:text-foreground"
              aria-hidden
            />
          </button>
        ) : (
          <h1 className="text-2xl font-bold">{group.name}</h1>
        )}
        <p className="mt-1 text-sm text-muted-foreground">
          メンバー {group.memberUids.length} 人 / オーナー {group.ownerUids.length} 人
          {myRole ? ` / あなたは${roleLabel(myRole)}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/groups">
          <Button variant="outline" size="sm">
            一覧へ
          </Button>
        </Link>
        {isOrganizer ? (
          <Link href={`/groups/${group.id}/audio-settings`}>
            <Button variant="outline" size="sm">
              サウンド設定
            </Button>
          </Link>
        ) : null}
        {isOwner ? (
          <Button variant="destructive" size="sm" onClick={onRequestDelete}>
            削除
          </Button>
        ) : (
          <Button variant="destructive" size="sm" onClick={onRequestLeave}>
            脱退
          </Button>
        )}
      </div>
    </header>
  );
}
