"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * パスワードの最小長。Firebase Authentication のサーバ側最小要件と同値で、
 * ここでは送信前にブラウザへ知らせるためだけに使う（クライアント検証は補助）。
 *
 * Firestore Rules と連動する数値ではないため `src/lib/limits.ts` には置かない
 * （limits.ts は rule リテラルとの drift check 対象の単一真実源）。
 */
export const PASSWORD_MIN_LENGTH = 6;

interface Props {
  /** id 生成の接頭辞。`${idPrefix}-email` / `${idPrefix}-password` になる。 */
  idPrefix: string;
  /** `autoComplete` の切替のみに使う（login: current-password / register: new-password）。 */
  mode: "login" | "register";
  email: string;
  password: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  /** 指定時のみ `<input minLength>` を付ける。既存 callsite の挙動を保つため任意。 */
  passwordMinLength?: number;
}

/**
 * メールアドレス ＋ パスワードの入力欄ペア。
 *
 * 08-auto-group-join-on-entry Phase 3 で `/login`（ログイン / 新規登録の両モード）と
 * `/join/[tid]`（ログインタブ / 新規登録タブ）に重複していた同形マークアップを集約した。
 */
export function EmailPasswordFields({
  idPrefix,
  mode,
  email,
  password,
  onEmailChange,
  onPasswordChange,
  passwordMinLength,
}: Props) {
  const emailId = `${idPrefix}-email`;
  const passwordId = `${idPrefix}-password`;
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={emailId}>メールアドレス</Label>
        <Input
          id={emailId}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={passwordId}>パスワード</Label>
        <Input
          id={passwordId}
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={passwordMinLength}
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
        />
      </div>
    </>
  );
}
