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
