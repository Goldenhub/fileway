export type StorageErrorCode =
  | "validation"
  | "config"
  | "not-found"
  | "bucket-not-found"
  | "auth-failed"
  | "size-exceeded"
  | "network"
  | "provider-error";

export interface StorageErrorOptions {
  /** HTTP status code when the failure came from an HTTP response. */
  statusCode?: number;
  /** Which driver produced the error: `"s3"`, `"cloudinary"`, or `"local"`. */
  provider?: string;
  /** The underlying error when this wraps a lower-level failure (e.g. `fetch`). */
  cause?: unknown;
}

/**
 * The single typed error for all storage failures. `code` is a stable
 * machine-readable discriminant; check it (rather than `instanceof`) to stay
 * safe across realms (workers, iframes, runtimes) and to keep errors
 * serializable. Subclasses `Error`, so existing `try/catch (err)` and
 * `err.message` handling keeps working.
 */
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly statusCode?: number;
  readonly provider?: string;
  readonly cause?: unknown;

  constructor(code: StorageErrorCode, message: string, options?: StorageErrorOptions) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    if (options?.statusCode !== undefined) this.statusCode = options.statusCode;
    if (options?.provider !== undefined) this.provider = options.provider;
    if (options?.cause !== undefined) this.cause = options.cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.statusCode !== undefined ? { statusCode: this.statusCode } : {}),
      ...(this.provider !== undefined ? { provider: this.provider } : {}),
    };
  }
}

/** True when `err` is the standard abort signal both `fetch` and Fileway use. */
export function isAbortError(err: unknown): err is DOMException {
  return err instanceof DOMException && err.name === "AbortError";
}
