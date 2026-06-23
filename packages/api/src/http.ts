/**
 * The shared API response envelope (user global patterns: success + data + error).
 * Every route returns this shape so the UI and tests parse one consistent contract.
 */
export interface ApiResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

export function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function fail(message: string): ApiResponse<never> {
  return { success: false, error: message };
}

/** Extract a safe message from an unknown thrown value (never leaks a stack/secret). */
export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
