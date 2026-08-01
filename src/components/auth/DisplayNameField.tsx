"use client";

import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";

interface Props {
  /** `<label for>` と `<input id>` に使う。`/login` は "reg-name" 固定（focus 制御が id 依存）。 */
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** default: "表示名"。`/login` は "表示名（必須）"。 */
  label?: string;
  /** default: 「{15} 文字以内で入力してください。」 */
  hint?: ReactNode;
  /** default: true */
  required?: boolean;
  autoFocus?: boolean;
  /** `<Input>` への追加 class（`/login` の muted ボックス内で "bg-background" を渡す）。 */
  inputClassName?: string;
  /** wrapper への追加 class。 */
  className?: string;
}

/**
 * 表示名の入力欄（Label + Input + hint）。
 *
 * 08-auto-group-join-on-entry Phase 3 で `/login`（新規登録モード）と
 * `/join/[tid]`（ゲストタブ / 新規登録タブ）に重複していた同形マークアップを集約した。
 *
 * `maxLength` は必ず `DISPLAY_NAME_MAX_LENGTH` で固定する（呼出側から変更させない）。
 * サークルの `memberDisplayNames` は Firestore Rules 側で `size() <= 15` を強制しており、
 * ここを緩めると自動所属が permission-denied で静かに失敗するため。
 */
export function DisplayNameField({
  id,
  value,
  onChange,
  label = "表示名",
  hint,
  required = true,
  autoFocus,
  inputClassName,
  className,
}: Props) {
  return (
    <div className={className ? `space-y-2 ${className}` : "space-y-2"}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        autoFocus={autoFocus}
        className={inputClassName}
      />
      <p className="text-xs text-muted-foreground">
        {hint ?? `${DISPLAY_NAME_MAX_LENGTH} 文字以内で入力してください。`}
      </p>
    </div>
  );
}
