import type { ErrorContext, Logger } from "./logging.js";

export interface UploadProgress {
  /** Bytes read from the source stream (after `beforeUpload` middleware) so far. */
  bytes: number;
  /** Known total (from `options.size`). Absent when the size is unknown. */
  total?: number;
  /** Fraction completed (`bytes / total`), 0..1. Present only when `total` is known. */
  progress?: number;
}

/**
 * Controls retry behavior for `FilewayClient` operations. Retries apply to
 * idempotent operations (`delete`, `get`, `getUrl`, `getPresignedUrl`) and to
 * `upload` when `UploadOptions.streamFactory` is provided (so each attempt can
 * produce a fresh stream). Only transient failures are retried: `network` and
 * `provider-error` codes, plus any error carrying HTTP 429/5xx. Validation,
 * config, auth, not-found, size, and abort errors are never retried.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts after the initial one. `0` disables retry. Default: 3. */
  maxRetries?: number;
  /** Base delay (ms) for the first retry. Default: 300. */
  baseDelayMs?: number;
  /** Cap on any single delay (ms), in case a retry is interrupted. Default: 10000. */
  maxDelayMs?: number;
  /** Exponential backoff multiplier applied to the delay each attempt. Default: 2. */
  multiplier?: number;
  /** Apply full jitter (uniform over `[0, delay]`) to avoid thundering herd. Default: true. */
  jitter?: boolean;
  /** Extra HTTP status codes (beyond 429 and 5xx) to treat as retryable. Default: none. */
  retryHttpStatuses?: number[];
  /** Whether non-`StorageError` failures (e.g. bare `TypeError: fetch failed`)
   * are treated as retryable. Default: true. */
  retryGenericErrors?: boolean;
}

export interface UploadOptions {
  filename: string;
  mimeType?: string;
  path?: string;
  metadata?: Record<string, string>;
  /** Known byte length of the stream. Enables zero-buffer streaming uploads on drivers that need it (e.g. S3). */
  size?: number;
  /** Aborts the upload in flight. Drivers stop reading the stream, clean up
   * (e.g. server-side multipart abort) and throw a `DOMException` with
   * `name === "AbortError"`. */
  signal?: AbortSignal;
  /** Called with progress as chunks flow through the upload stream. Large or
   * infrequent chunks report immediately; small chunks on fast streams are
   * throttled to at most one event per 100 ms. A final event always reports the
   * exact total. Not called on abort. */
  onProgress?: (progress: UploadProgress) => void;
  /**
   * Returns a fresh stream for retry attempts. A `ReadableStream` is consumed
   * after one read, so without this retrying an `upload` is impossible — the
   * data is gone after the first attempt. When provided, the client calls this
   * on each retry to re-produce the payload. The data source must be re-readable
   * (a file path, in-memory bytes, re-fetchable URL); a one-shot feed is not.
   * Ignored when no retry occurs.
   */
  streamFactory?: () => ReadableStream<Uint8Array>;
}

export interface UploadResult<TMeta extends Record<string, unknown>> {
  id: string;
  url: string;
  path: string;
  size: number;
  meta: TMeta;
}

export interface PresignedUrlOptions {
  /** Lifetime of the URL in seconds. Bounds are driver-specific
   * (e.g. S3 allows 1..604800). Defaults to 3600 when omitted. */
  expiresIn?: number;
}

export interface BaseDriver<TMeta extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
  ): Promise<UploadResult<TMeta>>;
  delete(path: string): Promise<boolean>;
  getUrl(path: string): Promise<string>;
  /**
   * Streams the stored file back as a WHATWG `ReadableStream<Uint8Array>`.
   * Throws when `path` does not exist.
   */
  get(path: string): Promise<ReadableStream<Uint8Array>>;
  /**
   * Returns a time-limited, signed URL granting read access to `path`.
   * Optional: drivers that cannot presign (e.g. LocalDriver) omit it.
   */
  getPresignedUrl?(path: string, options?: PresignedUrlOptions): Promise<string>;
}

export interface MiddlewareHook {
  beforeUpload?: (
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
  ) => Promise<
    | { stream?: ReadableStream<Uint8Array>; options?: UploadOptions }
    | void
  >;
  afterUpload?: (result: UploadResult<Record<string, unknown>>) => Promise<void>;
}

export interface FilewayConfig<TDriver extends BaseDriver> {
  driver: TDriver;
  middlewares?: MiddlewareHook[];
  /** Optional structured logger (dependency-free contract — adapt Pino,
   * Sentry, Datadog, etc.). Receives `info` events per operation and `error`
   * events on failure. Absent by default: nothing is logged. */
  logger?: Logger;
  /** Optional error hook called when an operation throws. Receives the raw
   * error (a `StorageError` for driver failures) plus context. Aborts are
   * skipped. A throwing/`onError` never masks the original error. */
  onError?: (error: unknown, context: ErrorContext) => void | Promise<void>;
  /** Optional retry behavior for transient failures. See `RetryConfig`. */
  retry?: RetryConfig;
}