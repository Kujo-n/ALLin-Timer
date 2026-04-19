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
