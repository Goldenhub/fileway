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
  /** Whether non-`StorageError` failures are treated as retryable. `true`
   * retries all of them, `false` none. Default: only `TypeError` (what `fetch`
   * throws on a network failure), so bugs in user code fail fast. */
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

/** Per-call options for `FilewayClient.delete`, `get`, `getUrl` and
 * `getPresignedUrl`. */
export interface OperationOptions {
  /** Cancels the operation: no further retry attempts are made and a pending
   * retry delay rejects with a `DOMException` named `AbortError`. */
  signal?: AbortSignal;
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

export interface BeforeUploadResult {
  /** Replacement stream for the driver to upload. */
  stream?: ReadableStream<Uint8Array>;
  /** Replacement upload options. */
  options?: UploadOptions;
  /**
   * Byte length of the returned `stream`. A new stream may not be the same
   * length as the old one (compression, encryption), so when `stream` is
   * returned the known size is dropped unless it is given here or as a changed
   * `options.size`. A transform that keeps the length (a checksum tap, say)
   * returns `size: options.size` to keep it.
   */
  size?: number;
}

export interface MiddlewareHook {
  beforeUpload?: (
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
  ) => Promise<BeforeUploadResult | void>;
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