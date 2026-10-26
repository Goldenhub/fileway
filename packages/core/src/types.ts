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
  /**
   * Cancels an attempt that makes no progress for this long (ms) and treats it
   * as a retryable `network` failure, so a hung connection retries instead of
   * waiting forever. Off by default.
   *
   * For `upload`, the timer resets whenever the driver reads from the stream,
   * and once the stream is fully read it limits the wait for the provider's
   * reply. Drivers stop reading while they send a buffered part (S3 multipart,
   * Cloudinary chunks), so set this above the time one part takes on your
   * slowest link. A slow *source* stream (e.g. relaying a client's upload) also
   * counts as no progress; use a generous value or leave it off there.
   *
   * For the other operations it is a plain per-attempt time limit; for `get`
   * it ends once the response starts, not after the body is read.
   */
  idleTimeoutMs?: number;
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
  /**
   * Stable ID for this upload; the stored name is built from it (e.g.
   * `<path>/<id>.<ext>`). `FilewayClient` generates one per `upload()` call
   * and reuses it on every retry, so a retry can never store a second copy.
   * Pass your own to make uploads idempotent across processes (a job queue
   * retrying after a crash). Reusing an ID overwrites that object.
   * 1 to 128 characters of `A-Z a-z 0-9 _ -`.
   */
  id?: string;
  /**
   * Set by `FilewayClient`: a random token unique to one `upload()` call
   * (shared by its retries). Drivers store it with the object so a lost
   * response can be recovered without confusing it with an older upload
   * that used the same `id`.
   */
  uploadToken?: string;
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
  /**
   * The path an upload with `options.id` would be stored at, without any I/O.
   * Optional: together with `head`, enables lost-response recovery and
   * `FilewayClient.getUploadStatus`.
   */
  pathFor?(options: UploadOptions & { id: string }): string;
  /** The stored object at `path`, or `null` when there is none. */
  head?(path: string): Promise<StoredObject<TMeta> | null>;
  /** Whether an upload to `path` has started but not finished (e.g. an open multipart upload). */
  isPending?(path: string): Promise<boolean>;
}

/** A stored object as reported by `BaseDriver.head`. */
export interface StoredObject<TMeta extends Record<string, unknown> = Record<string, unknown>>
  extends UploadResult<TMeta> {
  /** The `uploadToken` the object was stored with, when the provider keeps it. */
  uploadToken?: string;
  lastModified?: Date;
  contentType?: string;
}

/** Result of `FilewayClient.getUploadStatus`. */
export type UploadStatus<TMeta extends Record<string, unknown> = Record<string, unknown>> =
  | { state: "complete"; object: StoredObject<TMeta> }
  | { state: "pending" }
  | { state: "missing" }
  /** The driver cannot report status (it lacks `pathFor`/`head`). */
  | { state: "unsupported" };

/** Options for `FilewayClient.getUploadStatus`: the same `filename`/`path` the upload used. */
export interface UploadStatusOptions extends OperationOptions {
  filename: string;
  path?: string;
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