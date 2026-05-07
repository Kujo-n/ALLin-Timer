"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AppError } from "@/lib/errors";
import { MAX_TABLES, TABLE_LABEL_MAX_LENGTH } from "@/lib/limits";
import { logger } from "@/lib/logger";

interface Props {
  /**
   * 表示モードで使う現状の卓呼称デフォルト一覧。空配列なら「未設定」を表示。
   * 編集モード切替時に内部 state にコピーしてから編集する。
   */
  labels: readonly string[];
  /** organizer 以上のみ「編集」ボタンを出す。member は表示モード固定。 */
  canEdit: boolean;
  /**
   * 保存 handler。`setDefaultTableLabels({ gid, uid, labels })` を呼ぶ wrapper。
   * 失敗時は throw して onError で表示。
   */
  onSave: (labels: string[]) => Promise<void>;
  onError?: (message: string) => void;
}

/**
 * Phase C: サークル詳細画面の「テーブル呼称デフォルト」inline edit カード。
 *
 *  - 表示モード: `1) 赤卓 / 2) 青卓 / ...` の番号付きリスト。0 件なら「未設定」
 *  - 編集モード（organizer のみ）: 各行 Input + 削除ボタン、最下部に「+ 追加」と保存/キャンセル
 *  - 並び替えは MVP 範囲外（削除→再追加で対応）
 *  - 各 Input は maxLength=TABLE_LABEL_MAX_LENGTH (= 10) で UI 側でも制限
 *  - 配列長は MAX_TABLES (= 6) まで（追加ボタンは到達時 disabled）
 *
 * 新規 tournament 作成時に index 順でコピーされる旨をヘルプテキストで示す。
 */
export function GroupDefaultTableLabelsCard({
  labels,
  canEdit,
  onSave,
  onError,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraft([...labels]);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft([]);
    setEditing(false);
  }

  function setLabelAt(idx: number, value: string) {
    setDraft((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }

  function removeAt(idx: number) {
    setDraft((prev) => prev.filter((_, i) => i !== idx));
  }

  function addRow() {
    if (draft.length >= MAX_TABLES) return;
    setDraft((prev) => [...prev, ""]);
  }

  async function handleSave() {
    setSaving(true);
    try {
      // 空文字 / 空白のみの行は保存前に除外（service / repo は空文字を弾くため UX 配慮）。
      const cleaned = draft
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      await onSave(cleaned);
      setEditing(false);
      setDraft([]);
    } catch (e) {
      const wrapped = AppError.from(
        e,
        "firestore/write_failed",
        "テーブル呼称デフォルトの更新に失敗しました",
      );
      logger.warn(wrapped.message, { code: wrapped.code });
      onError?.(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card aria-label="default-table-labels-card">
      <CardHeader>
        <CardTitle>テーブル呼称デフォルト</CardTitle>
        <CardDescription>
          新規トーナメント作成時、上から順に各卓へ自動でコピーされます（最大{" "}
          {MAX_TABLES} 件 / 各 {TABLE_LABEL_MAX_LENGTH} 文字）。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <div className="space-y-2">
            {draft.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                呼称が登録されていません。下のボタンで追加してください。
              </p>
            ) : (
              <ol className="space-y-2">
                {draft.map((value, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <span className="w-6 text-sm text-muted-foreground">
                      {idx + 1})
                    </span>
                    <Input
                      value={value}
                      onChange={(e) => setLabelAt(idx, e.target.value)}
                      maxLength={TABLE_LABEL_MAX_LENGTH}
                      placeholder="赤卓"
                      disabled={saving}
                      aria-label={`default-table-label-${idx + 1}`}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={saving}
                      onClick={() => removeAt(idx)}
                      aria-label={`remove-default-table-label-${idx + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
                disabled={saving || draft.length >= MAX_TABLES}
              >
                + 追加
              </Button>
              <span className="flex-1" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={cancelEdit}
                disabled={saving}
              >
                キャンセル
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        ) : labels.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">未設定</p>
            {canEdit ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={startEdit}
              >
                編集
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            <ol className="list-decimal space-y-1 pl-6 text-sm">
              {labels.map((label, idx) => (
                <li key={idx} className="font-medium">
                  {label}
                </li>
              ))}
            </ol>
            {canEdit ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={startEdit}
              >
                編集
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
