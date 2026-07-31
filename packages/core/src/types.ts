export interface UploadProgress {
  /** Bytes read from the source stream (after `beforeUpload` middleware) so far. */
  bytes: number;
  /** Known total (from `options.size`). Absent when the size is unknown. */
  total?: number;
  /** Fraction completed (`bytes / total`), 0..1. Present only when `total` is known. */
  progress?: number;
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
}