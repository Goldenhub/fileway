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
 * produce a fresh stream). Only transient failures are retried: `network`,
 * `timeout`, `rate-limited` and `provider-error` codes, plus any error
 * carrying HTTP 429/5xx. Validation,
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
   * as a retryable `timeout` failure, so a hung connection retries instead of
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
   * after one read, so without this retrying an `upload` is impossible: the
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
}

/** Passed by `FilewayClient` as the third argument of `BaseDriver.upload`. */
export interface UploadContext {
  /**
   * A random token unique to one `upload()` call (shared by its retries).
   * Drivers store it with the object and return it from `head`, so a lost
   * response can be recovered without confusing it with an older upload that
   * used the same `id`.
   */
  uploadToken: string;
}

export interface UploadResult<TMeta extends Record<string, unknown>> {
  id: string;
  url: string;
  path: string;
  size: number;
  meta: TMeta;
}

/** Per-call options for every operation other than `upload`, on both
 * `FilewayClient` and `BaseDriver`. */
export interface OperationOptions {
  /** Cancels the operation: the request in flight is aborted, no further
   * retry attempts are made, and it rejects with a `DOMException` named
   * `AbortError`. */
  signal?: AbortSignal;
}

export interface PresignedUrlOptions extends OperationOptions {
  /** Lifetime of the URL in seconds. Defaults to 3600. Limits are
   * provider-specific: S3, GCS and Azure allow at most 604800 (7 days);
   * Cloudinary and Supabase accept any positive integer. */
  expiresIn?: number;
}

export interface BaseDriver<TMeta extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  /** Stores the stream. `context` is supplied by `FilewayClient`; drivers
   * used directly may receive none. */
  upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
    context?: UploadContext,
  ): Promise<UploadResult<TMeta>>;
  /** Deletes the object at `path`. Deleting a missing object is not an error. */
  delete(path: string, options?: OperationOptions): Promise<void>;
  getUrl(path: string, options?: OperationOptions): Promise<string>;
  /**
   * Streams the stored file back as a WHATWG `ReadableStream<Uint8Array>`.
   * Throws when `path` does not exist.
   */
  get(path: string, options?: OperationOptions): Promise<ReadableStream<Uint8Array>>;
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
  head?(path: string, options?: OperationOptions): Promise<StoredObject<TMeta> | null>;
  /** Whether an upload to `path` has started but not finished (e.g. an open multipart upload). */
  isPending?(path: string, options?: OperationOptions): Promise<boolean>;
  /** One page of the objects under `options.prefix`. */
  list?(options?: ListOptions): Promise<ListPage>;
  /** Copies `from` to `to` on the same storage. */
  copy?(from: string, to: string, options?: CopyOptions): Promise<void>;
  /** Moves (renames) `from` to `to`. Without it, the client copies then deletes. */
  move?(from: string, to: string, options?: CopyOptions): Promise<void>;
}

export interface ListOptions extends OperationOptions {
  /** Only objects whose path starts with this. Omitted or "" lists the root;
   * use a trailing "/" to list a folder ("photos/"). */
  prefix?: string;
  /**
   * `false` (default): one folder level. Objects directly under `prefix` go in
   * `objects`; deeper paths are rolled up into `folders`.
   * `true`: every object under `prefix`, at any depth; `folders` is empty.
   */
  recursive?: boolean;
  /** Page size, 1 to 1000. Default 100. A page may hold fewer. */
  limit?: number;
  /** The `cursor` from the previous page. */
  cursor?: string;
}

/** An object as returned by `list`. Listing returns less than `head`. */
export interface ListedObject {
  path: string;
  size: number;
  lastModified?: Date;
  etag?: string;
  contentType?: string;
}

export interface ListPage {
  objects: ListedObject[];
  /** Folder prefixes one level below `prefix`, each ending in "/". */
  folders: string[];
  /** Present when there are more results. Opaque: pass it back unchanged. */
  cursor?: string;
}

export interface CopyOptions extends OperationOptions {
  /** Replace an existing destination. Default false: an existing destination
   * fails with a `conflict` error. */
  overwrite?: boolean;
}

/** The `result.meta` shape of a driver's uploads. */
export type DriverMeta<TDriver extends BaseDriver> = Awaited<ReturnType<TDriver["upload"]>>["meta"];

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

/**
 * Upload hooks. `TMeta` is the driver's metadata shape; inline middleware on a
 * `FilewayClient` gets it inferred, while a reusable middleware can leave it
 * as the default and work with any driver.
 */
export interface MiddlewareHook<TMeta extends Record<string, unknown> = Record<string, unknown>> {
  beforeUpload?: (
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
  ) => Promise<BeforeUploadResult | void>;
  /** Runs after a successful upload with its result and the options the
   * driver received (after `beforeUpload`). */
  afterUpload?: (result: UploadResult<TMeta>, options: UploadOptions) => Promise<void>;
}

export interface FilewayConfig<TDriver extends BaseDriver> {
  driver: TDriver;
  middlewares?: MiddlewareHook<DriverMeta<TDriver>>[];
  /** Optional structured logger (a dependency-free contract: adapt Pino,
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