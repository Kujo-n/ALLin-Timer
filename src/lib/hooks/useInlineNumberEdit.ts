"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";

import { unwrapOrFrom } from "@/lib/errors";

interface UseInlineNumberEditOptions {
  /** 現在の値（編集モード解除時の表示・cancel 時の戻し先）。group などの reactive value から渡す。 */
  currentValue: number;
  /** 編集確定時の保存処理。AppError を throw すると hook が onError に整形して通知する。 */
  save: (value: number) => Promise<void>;
  /** 入力値の検証。`null` なら OK、`string` ならエラーメッセージ（onError 経由で通知）。 */
  validate: (value: number) => string | null;
  /** 保存成功後に呼ぶ後処理（reload / refreshGroups 等）。 */
  onSaved?: () => Promise<void> | void;
  /** 検証失敗 / 保存失敗時のエラー通知。`<code>: <message>` 形式で渡る。 */
  onError: (message: string) => void;
  /** save が AppError でない error を throw した場合の fallback code。 */
  errorCode: string;
  /** save が AppError でない error を throw した場合の fallback message。 */
  errorMessage: string;
}

export interface UseInlineNumberEditState {
  /** 編集モードか。true のときフォーム、false のとき表示モード。 */
  editing: boolean;
  /** 入力欄の文字列値（数値変換は parse 時に行う）。 */
  value: string;
  /** 保存中か。submit ボタン / cancel ボタンの disabled 判定に使う。 */
  saving: boolean;
  /** Input element ref。start() 時に focus + select するため。 */
  inputRef: RefObject<HTMLInputElement | null>;
  /** 編集モード開始（input に focus + select）。 */
  start: () => void;
  /** 編集モード解除（value を currentValue に戻す）。 */
  cancel: () => void;
  /** Input の onChange ハンドラ。 */
  onChange: (next: string) => void;
  /** Input の onKeyDown ハンドラ（Esc で cancel）。 */
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** Form の onSubmit ハンドラ（validate → save → onSaved の順で実行）。 */
  onSubmit: (e: FormEvent) => Promise<void>;
}

/**
 * Inline 数値編集（表示 ↔ 数字入力 + 保存/キャンセル）の state machine 共通化。
 *
 * Phase 4 architect-refactor (P5-1) で `group-detail-client.tsx` の
 * `finishedTournamentCount` / `defaultSeatsPerTable` / `name` 等の inline edit が
 * 同形パターンを 3 回手書きしていた重複を集約する。
 *
 * 利用例（group-detail の finishedTournamentCount）:
 *
 * ```tsx
 * const editor = useInlineNumberEdit({
 *   currentValue: group.finishedTournamentCount,
 *   save: (value) => setFinishedTournamentCount({ gid, uid: user.uid, value }),
 *   validate: (n) =>
 *     Number.isInteger(n) && n >= 0
 *       ? null
 *       : "validation/finished-count-invalid: 開催数は 0 以上の整数で指定してください",
 *   onSaved: async () => {
 *     await reload();
 *     await refreshGroups();
 *   },
 *   onError: setError,
 *   errorCode: "group/finished-count-failed",
 *   errorMessage: "開催数の更新に失敗しました",
 * });
 * ```
 *
 * `currentValue` が外側で変化したら、編集中でなければ表示値を追従する（reactive sync）。
 * 編集中の場合は currentValue 変化を反映しない（ユーザー入力を上書きしない）。
 */
export function useInlineNumberEdit(options: UseInlineNumberEditOptions): UseInlineNumberEditState {
  const { currentValue, save, validate, onSaved, onError, errorCode, errorMessage } = options;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(currentValue));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 編集していないときは外側の currentValue 変化に追従する。
  // 編集中はユーザー入力を上書きしないため何もしない。
  useEffect(() => {
    if (!editing) setValue(String(currentValue));
  }, [currentValue, editing]);

  function start(): void {
    setValue(String(currentValue));
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  function cancel(): void {
    setEditing(false);
    setValue(String(currentValue));
  }

  function onChange(next: string): void {
    setValue(next);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const parsed = Number(value);
    const validateError = validate(parsed);
    if (validateError !== null) {
      onError(validateError);
      return;
    }
    if (parsed === currentValue) {
      // 同値ならネットワーク呼び出しせず編集モードだけ抜ける（既存挙動）。
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await save(parsed);
      setEditing(false);
      await onSaved?.();
    } catch (err) {
      const wrapped = unwrapOrFrom(err, errorCode, errorMessage);
      onError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setSaving(false);
    }
  }

  return {
    editing,
    value,
    saving,
    inputRef,
    start,
    cancel,
    onChange,
    onKeyDown,
    onSubmit,
  };
}
