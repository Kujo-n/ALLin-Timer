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
import { TableColorPresetRadioGroup } from "@/components/tournament/_table-label-edit/TableColorPresetRadioGroup";
import { AppError } from "@/lib/errors";
import { MAX_TABLES, TABLE_LABEL_MAX_LENGTH } from "@/lib/limits";
import { logger } from "@/lib/logger";

interface Props {
  /**
   * 表示モードで使う現状の Table 名デフォルト一覧。空配列なら「未設定」を表示。
   * 編集モード切替時に内部 state にコピーしてから編集する。
   */
  labels: readonly string[];
  /**
   * `labels` と index 1:1 で対応する Table 色デフォルト。null は色未設定。
   * 旧 doc では colors が空配列のため、`labels.length` より短い場合は表示時に null パディング扱い。
   */
  colors: readonly (string | null)[];
  /** organizer 以上のみ「編集」ボタンを出す。member は表示モード固定。 */
  canEdit: boolean;
  /**
   * 保存 handler。`setDefaultTableSettings({ gid, uid, labels, colors })` を呼ぶ wrapper。
   * 失敗時は throw して onError で表示。labels と colors は同じ長さで渡す。
   */
  onSave: (labels: string[], colors: (string | null)[]) => Promise<void>;
  onError?: (message: string) => void;
}

/**
 * Phase C / 02-02: サークル詳細画面の「Table 名デフォルト」inline edit カード。
 *
 * 02-02 改修で「色も一緒に登録できる」運用要望に対応。卓マットの色は買い替えるまで
 * 固定なので、トーナメント開催の度に設定する手間を省く。
 *
 *  - 表示モード: 各行に色チップ + Table 名。0 件なら「未設定」
 *  - 編集モード（organizer のみ）: 各行 [Table 名 Input + 色プリセット tile + 削除] / 「+ 追加」/「保存・キャンセル」
 *  - 並び替えは MVP 範囲外（削除→再追加で対応）
 *  - Input は maxLength=TABLE_LABEL_MAX_LENGTH (= 10) で UI 側でも制限
 *  - 配列長は MAX_TABLES (= 6) まで（追加ボタンは到達時 disabled）
 *  - 色プリセットは TableLabelEditPopover と共通の TABLE_COLOR_PRESETS を使用
 *    （カスタム hex picker は本カードには出さない。詳細色は Popover で個別設定する）
 *
 * 新規 tournament 作成時に index 順で labels / colors の両方がコピーされる。
 */
export function GroupDefaultTableLabelsCard({
  labels,
  colors,
  canEdit,
  onSave,
  onError,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState<string[]>([]);
  const [colorDraft, setColorDraft] = useState<(string | null)[]>([]);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setLabelDraft([...labels]);
    // colors が短い旧 doc に対しても labels.length に揃える形で hydrate。
    setColorDraft(
      labels.map((_, i) => (i < colors.length ? colors[i] : null)),
    );
    setEditing(true);
  }

  function cancelEdit() {
    setLabelDraft([]);
    setColorDraft([]);
    setEditing(false);
  }

  function setLabelAt(idx: number, value: string) {
    setLabelDraft((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }

  function setColorAt(idx: number, value: string | null) {
    setColorDraft((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }

  function removeAt(idx: number) {
    setLabelDraft((prev) => prev.filter((_, i) => i !== idx));
    setColorDraft((prev) => prev.filter((_, i) => i !== idx));
  }

  function addRow() {
    if (labelDraft.length >= MAX_TABLES) return;
    setLabelDraft((prev) => [...prev, ""]);
    setColorDraft((prev) => [...prev, null]);
  }

  async function handleSave() {
    setSaving(true);
    try {
      // 空文字 / 空白のみの行は保存前に除外（service / repo は空文字を弾くため UX 配慮）。
      // labels と colors は同 index で対応するので、空行を落とすときは両方落とす。
      const cleanedLabels: string[] = [];
      const cleanedColors: (string | null)[] = [];
      labelDraft.forEach((s, i) => {
        const t = s.trim();
        if (t.length === 0) return;
        cleanedLabels.push(t);
        cleanedColors.push(colorDraft[i] ?? null);
      });
      await onSave(cleanedLabels, cleanedColors);
      setEditing(false);
      setLabelDraft([]);
      setColorDraft([]);
    } catch (e) {
      const wrapped = AppError.from(
        e,
        "firestore/write_failed",
        "Table 名デフォルトの更新に失敗しました",
      );
      logger.warn(wrapped.message, { code: wrapped.code });
      onError?.(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setSaving(false);
    }
  }

  // 表示モードで colors が短い旧 doc のときも index で参照できるようにヘルパー化。
  function colorAt(i: number): string | null {
    return i < colors.length ? colors[i] : null;
  }

  return (
    <Card aria-label="default-table-labels-card">
      <CardHeader>
        <CardTitle>Table 名デフォルト</CardTitle>
        <CardDescription>
          新規トーナメント作成時、上から順に各卓へ Table 名と色が自動でコピーされます（最大{" "}
          {MAX_TABLES} 件 / 各 {TABLE_LABEL_MAX_LENGTH} 文字）。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <div className="space-y-3">
            {labelDraft.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Table 名が登録されていません。下のボタンで追加してください。
              </p>
            ) : (
              <ol className="space-y-3">
                {labelDraft.map((value, idx) => (
                  <li key={idx} className="space-y-2 rounded-md border p-2">
                    <div className="flex items-center gap-2">
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
                    </div>
                    <div className="pl-8">
                      <TableColorPresetRadioGroup
                        value={colorDraft[idx] ?? null}
                        onChange={(next) => setColorAt(idx, next)}
                        disabled={saving}
                        ariaLabelPrefix={`default-table-${idx + 1}`}
                        ariaLabelStyle="compact"
                        size="sm"
                        groupAriaLabel={`default-table-color-presets-${idx + 1}`}
                      />
                    </div>
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
                disabled={saving || labelDraft.length >= MAX_TABLES}
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
            <ol className="space-y-1 text-sm">
              {labels.map((label, idx) => {
                const color = colorAt(idx);
                return (
                  <li
                    key={idx}
                    className="flex items-center gap-2 font-medium"
                  >
                    <span className="w-6 text-muted-foreground">
                      {idx + 1})
                    </span>
                    {color ? (
                      <span
                        aria-hidden
                        className="inline-block h-3 w-3 shrink-0 rounded-full border border-black/10"
                        style={{ backgroundColor: color }}
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="inline-block h-3 w-3 shrink-0 rounded-full border border-dashed"
                      />
                    )}
                    <span>{label}</span>
                  </li>
                );
              })}
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
