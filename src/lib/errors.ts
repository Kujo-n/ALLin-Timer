export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  static from(error: unknown, code: string, message?: string): AppError {
    if (error instanceof AppError) return error;
    const msg = message ?? (error instanceof Error ? error.message : "Unknown error");
    return new AppError(msg, code, error);
  }
}

/**
 * 既に `AppError` であればそのまま返し、そうでなければ `AppError.from` でラップする。
 *
 * 二重ラップを避けたい呼出側のための薄い helper。`AppError.from` は内部で同じ
 * `instanceof AppError` チェックを行うため挙動は等価だが、呼出側のコードで
 * 意図（「既に wrap 済みかもしれないものを安全に通したい」）を明示できる。
 *
 * 例: repository 内で wrap 済みのエラーが UI まで届いた場合、UI 側でさらに
 *     `AppError.from` するとログを 2 重に出してしまうことがあるため、本 helper を
 *     使って既存の wrap を尊重しつつ未 wrap の場合のみ補完する。
 */
export function unwrapOrFrom(
  error: unknown,
  code: string,
  message?: string,
): AppError {
  return error instanceof AppError ? error : AppError.from(error, code, message);
}

/**
 * 任意の値からエラーコード文字列を安全に取り出す。
 *
 * - `AppError` ならその `code`
 * - `code` プロパティを持つ object（FirebaseError 等）ならそれ
 * - それ以外は `"unknown"`
 *
 * `Promise.allSettled` の `reason` や `catch` で受けた `unknown` を
 * ログ用に整形するときに使う。
 */
export function getErrorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "unknown";
}

/**
 * UI 表示用にエラーを `"<code>: <message>"` 形式の文字列に整形する。
 *
 * UI コンポーネント全般で頻出する `\`${err.code}: ${err.message}\`` パターンを
 * 1 か所に集約するための helper。将来「code を非表示にして message のみ表示」
 * など UI フォーマットを変更したくなった際の単一書換点として導入。
 *
 * architect-refactor 20260510 で追加。
 */
export function formatErrorForDisplay(err: { code: string; message: string }): string {
  return `${err.code}: ${err.message}`;
}

/**
 * service 層の入口で `tid` / `uid` / `gid` などの非空 string 引数を防御する。
 * empty 文字列・whitespace-only・非 string は `validation/empty-string` で early throw する。
 *
 * 通常の TypeScript 型システムでは `tid: string` を `""` で呼ばれた場合の防御がないため、
 * Firestore SDK の `getDoc(doc(ref, ""))` が `invalid-argument` で失敗するまで素通りしていた。
 * このヘルパーを通すことで、より明確な error code でフェイルファストに倒す。
 *
 * architect-refactor 20260510 (2 サイクル目) で追加。前サイクルの finding-7 を解消。
 */
export function assertNonEmptyString(
  value: unknown,
  paramName: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(
      `${paramName} を指定してください`,
      "validation/empty-string",
    );
  }
}
