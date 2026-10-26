export * from "./types.js";
export * from "./validation.js";
export * from "./progress.js";
export * from "./errors.js";
export * from "./logging.js";
export * from "./retry.js";

// Replaced with the package.json version at build time (see tsup.config.ts).
declare const __FILEWAY_VERSION__: string | undefined;
export const version: string = typeof __FILEWAY_VERSION__ === "string" ? __FILEWAY_VERSION__ : "0.0.0-dev";

import type {
  BaseDriver,
  FilewayConfig,
  OperationOptions,
  PresignedUrlOptions,
  RetryConfig,
  StoredObject,
  UploadOptions,
  UploadResult,
  UploadStatus,
  UploadStatusOptions,
} from "./types.js";
import { withProgress } from "./progress.js";
import { StorageError, isAbortError } from "./errors.js";
import { abortError, validateUploadId, validateUploadOptions } from "./validation.js";
import { delayWithJitter, isRetryable, sleep } from "./retry.js";
import { IdleTimer, linkSignals, raceAbort, timeoutError, withActivity, withTimeLimit } from "./timeout.js";
import type { ErrorContext, Logger, LogLevel, Operation } from "./logging.js";

/** The metadata shape of the configured driver's upload results. */
type DriverMeta<TConfig extends FilewayConfig<BaseDriver>> = Awaited<ReturnType<TConfig["driver"]["upload"]>>["meta"];

export class FilewayClient<const TConfig extends FilewayConfig<BaseDriver>> {
  private driver: TConfig["driver"];
  private middlewares: NonNullable<TConfig["middlewares"]>;
  private logger: Logger | undefined;
  private onError: ((error: unknown, context: ErrorContext) => void | Promise<void>) | undefined;
  private retry: RetryConfig;

  constructor(config: TConfig) {
    this.driver = config.driver;
    this.middlewares = config.middlewares ?? [];
    this.logger = config.logger;
    this.onError = config.onError;
    this.retry = config.retry ?? {};
    const idle = this.retry.idleTimeoutMs;
    if (idle !== undefined && !(Number.isFinite(idle) && idle > 0)) {
      throw new StorageError("config", "retry.idleTimeoutMs must be a positive number of milliseconds");
    }
  }

  async upload(
    stream: ReadableStream<Uint8Array>,
    // Accept the driver's own upload options (e.g. Cloudinary's
    // `deliveryType`) on top of the core ones.
    options: UploadOptions & Parameters<TConfig["driver"]["upload"]>[1],
  ): Promise<ReturnType<TConfig["driver"]["upload"]>> {
    const started = Date.now();
    const maxRetries = this.retry.maxRetries ?? 3;
    const canRetry = options.streamFactory !== undefined && maxRetries > 0;
    const idleMs = this.retry.idleTimeoutMs;

    // One ID and token for the whole call, shared by every retry: a retry then
    // targets the same object, and a lost response can be recovered by asking
    // the driver whether that object already landed.
    if (options.id !== undefined) {
      try {
        validateUploadId(options.id);
      } catch (error) {
        await this.reportFailure(error, { operation: "upload", durationMs: 0, filename: options.filename });
        throw error;
      }
    }
    const id = options.id ?? globalThis.crypto.randomUUID();
    const uploadToken = globalThis.crypto.randomUUID();
    const base = { ...options, id, uploadToken };

    let attempt = 1;
    let activeOptions: typeof options = { ...base };

    this.emit("info", "upload started", {
      operation: "upload",
      id,
      ...(options.filename !== undefined ? { filename: options.filename } : {}),
      ...(options.path !== undefined ? { path: options.path } : {}),
      ...(options.mimeType !== undefined ? { mimeType: options.mimeType } : {}),
      ...(options.size !== undefined ? { size: options.size } : {}),
    });

    for (;;) {
      // Every attempt starts from the caller's original options, so
      // `beforeUpload` middleware never transforms its own earlier output.
      let activeStream = attempt === 1 ? stream : options.streamFactory!();
      activeOptions = { ...base };
      let reachedDriver = false;
      // With `idleTimeoutMs`, each attempt gets its own cancel signal, linked to
      // the caller's, and a timer that fires when the attempt stops progressing.
      let idle: IdleTimer | undefined;
      let linked: { signal: AbortSignal; dispose: () => void } | undefined;
      const endAttempt = () => {
        idle?.stop();
        linked?.dispose();
      };

      try {
        for (const middleware of this.middlewares) {
          if (middleware.beforeUpload) {
            const result = await middleware.beforeUpload(activeStream, activeOptions);
            if (!result) continue;
            const sizeBefore = activeOptions.size;
            if (result.options) activeOptions = result.options;
            if (result.stream) {
              activeStream = result.stream;
              // The new stream may not be the old length. Keep a size only if
              // this middleware vouched for it; a spread `...options` carries
              // the old size along by accident and does not count.
              const size =
                result.size ?? (activeOptions.size !== sizeBefore ? activeOptions.size : undefined);
              activeOptions = withSize(activeOptions, size);
            }
          }
        }
        // Middleware may rebuild options from scratch; the identity must survive.
        activeOptions = { ...activeOptions, id, uploadToken };

        let attemptSignal: AbortSignal | undefined;
        if (idleMs !== undefined) {
          const attemptAbort = new AbortController();
          const timer = new IdleTimer(idleMs, () => attemptAbort.abort(abortError("upload attempt timed out")));
          idle = timer;
          linked = linkSignals(options.signal, attemptAbort.signal);
          attemptSignal = linked.signal;
          activeStream = withActivity(activeStream, () => timer.touch());
          activeOptions = { ...activeOptions, signal: attemptSignal };
          timer.touch();
        }

        const progressStream = activeOptions.onProgress
          ? withProgress(activeStream, activeOptions.onProgress, activeOptions.size)
          : activeStream;

        reachedDriver = true;
        const pending = this.driver.upload(progressStream, activeOptions);
        // Don't wait on a driver that ignores its signal once the attempt is cancelled.
        const uploadResult = await (attemptSignal ? raceAbort(pending, attemptSignal) : pending);
        endAttempt();
        return (await this.finishUpload(uploadResult, started)) as ReturnType<TConfig["driver"]["upload"]>;
      } catch (caught) {
        endAttempt();
        // An attempt we cancelled for inactivity is a retryable network failure;
        // the caller's own abort stays final.
        const error =
          idle?.fired && !options.signal?.aborted ? timeoutError("upload", idleMs!, caught) : caught;

        // The provider may have stored the object even though the response was
        // lost. If it did, return it instead of re-sending (or failing).
        if (reachedDriver && isRetryable(error, this.retry)) {
          const recovered = await this.recoverLostResponse({ ...activeOptions, id }, uploadToken);
          if (recovered) {
            this.emit("info", "upload recovered after lost response", { operation: "upload", id, attempt });
            return (await this.finishUpload(recovered, started)) as ReturnType<TConfig["driver"]["upload"]>;
          }
        }

        const delay = delayWithJitter(attempt, this.retry);
        const canRetryNow = canRetry && isRetryable(error, this.retry) && attempt <= maxRetries;
        if (!canRetryNow) {
          await this.reportFailure(error, {
            operation: "upload",
            durationMs: Date.now() - started,
            ...(activeOptions.filename !== undefined ? { filename: activeOptions.filename } : {}),
            ...(activeOptions.path !== undefined ? { path: activeOptions.path } : {}),
            ...(activeOptions.mimeType !== undefined ? { mimeType: activeOptions.mimeType } : {}),
            ...(activeOptions.size !== undefined ? { size: activeOptions.size } : {}),
          });
          throw error;
        }

        this.emit("warn", "upload failed, retrying", {
          operation: "retry",
          attempt,
          maxRetries,
          delayMs: delay,
          error: error instanceof Error ? { name: error.name, message: error.message } : {},
        });

        await sleep(delay, options.signal);
        attempt += 1;
      }
    }
  }

  /**
   * Reports whether the upload with `id` is stored, still in progress, or
   * missing. Pass the same `filename` and `path` the upload used. Works across
   * processes: a job that crashed mid-upload can check before redoing it.
   */
  async getUploadStatus(id: string, options: UploadStatusOptions): Promise<UploadStatus<DriverMeta<TConfig>>> {
    const { signal, ...uploadOptions } = options;
    validateUploadOptions({ ...uploadOptions, id });
    const { pathFor, head, isPending } = this.driver;
    if (!pathFor || !head) return { state: "unsupported" };

    const path = pathFor.call(this.driver, { ...uploadOptions, id });
    return this.runWithRetry(
      "getUploadStatus",
      path,
      async (): Promise<UploadStatus<DriverMeta<TConfig>>> => {
        const object = await head.call(this.driver, path);
        if (object) return { state: "complete", object: object as StoredObject<DriverMeta<TConfig>> };
        if (isPending && (await isPending.call(this.driver, path))) return { state: "pending" };
        return { state: "missing" };
      },
      signal,
    );
  }

  /** Runs `afterUpload` middleware and logs success for a stored upload. */
  private async finishUpload(
    result: UploadResult<Record<string, unknown>>,
    started: number,
  ): Promise<UploadResult<Record<string, unknown>>> {
    for (const middleware of this.middlewares) {
      if (middleware.afterUpload) {
        await middleware.afterUpload(result);
      }
    }
    this.emit("info", "upload succeeded", {
      operation: "upload",
      id: result.id,
      url: result.url,
      path: result.path,
      size: result.size,
      durationMs: Date.now() - started,
    });
    return result;
  }

  /**
   * After a retryable failure, asks the driver whether this call's object was
   * stored anyway. Accepts it only if it carries this call's `uploadToken`
   * (when the driver keeps tokens) and the expected size (when known).
   * Best-effort: any failure here returns `undefined` so the original error wins.
   */
  private async recoverLostResponse(
    options: UploadOptions & { id: string },
    uploadToken: string,
  ): Promise<UploadResult<Record<string, unknown>> | undefined> {
    const { pathFor, head } = this.driver;
    if (!pathFor || !head) return undefined;
    try {
      const object = await head.call(this.driver, pathFor.call(this.driver, options));
      if (!object) return undefined;
      if (object.uploadToken !== undefined && object.uploadToken !== uploadToken) return undefined;
      if (options.size !== undefined && object.size !== options.size) return undefined;
      const { uploadToken: _token, lastModified: _modified, contentType: _type, ...result } = object;
      return result;
    } catch {
      return undefined;
    }
  }

  async delete(path: string, options?: OperationOptions): Promise<boolean> {
    return this.runWithRetry("delete", path, async () => this.driver.delete(path), options?.signal);
  }

  async getUrl(path: string, options?: OperationOptions): Promise<string> {
    return this.runWithRetry("getUrl", path, async () => this.driver.getUrl(path), options?.signal);
  }

  async get(path: string, options?: OperationOptions): Promise<ReadableStream<Uint8Array>> {
    return this.runWithRetry("get", path, async () => this.driver.get(path), options?.signal);
  }

  async getPresignedUrl(
    path: string,
    options?: PresignedUrlOptions & OperationOptions,
  ): Promise<string> {
    const { signal, ...presignOptions } = options ?? {};
    return this.runWithRetry("getPresignedUrl", path, async () => {
      if (!this.driver.getPresignedUrl) {
        throw new StorageError(
          "config",
          `driver ${this.driver.name} does not support presigned URLs`,
          { provider: this.driver.name },
        );
      }
      return this.driver.getPresignedUrl!(path, options ? presignOptions : undefined);
    }, signal);
  }

  private async runWithRetry<T>(
    operation: "delete" | "getUrl" | "get" | "getPresignedUrl" | "getUploadStatus",
    path: string,
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const started = Date.now();
    const maxRetries = this.retry.maxRetries ?? 3;

    this.emit("info", `${operation} started`, { operation, path });

    let attempt = 1;
    for (;;) {
      try {
        if (signal?.aborted) throw abortError(`${operation} aborted`);
        const idleMs = this.retry.idleTimeoutMs;
        const result = await (idleMs === undefined ? fn() : withTimeLimit(fn(), idleMs, operation));
        this.emit("info", `${operation} succeeded`, { operation, path, durationMs: Date.now() - started });
        return result;
      } catch (error) {
        const delay = delayWithJitter(attempt, this.retry);
        const canRetryNow = isRetryable(error, this.retry) && attempt <= maxRetries;
        if (!canRetryNow) {
          await this.reportFailure(error, { operation, durationMs: Date.now() - started, path });
          throw error;
        }

        this.emit("warn", `${operation} failed, retrying`, {
          operation: "retry",
          attempt,
          maxRetries,
          delayMs: delay,
          error: error instanceof Error ? { name: error.name, message: error.message } : {},
        });

        try {
          await sleep(delay, signal);
        } catch (abort) {
          await this.reportFailure(abort, { operation, durationMs: Date.now() - started, path });
          throw abort;
        }
        attempt += 1;
      }
    }
  }

  private emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const log = this.logger?.[level];
    if (!log) return;
    try {
      log.call(this.logger, message, meta);
    } catch (err) {
      // A user logger must never break the operation it is reporting on.
      console.error(`[fileway] logger.${level} threw`, err);
    }
  }

  private async notifyError(error: unknown, context: ErrorContext): Promise<void> {
    if (!this.onError) return;
    try {
      await this.onError(error, context);
    } catch {
      // A failing onError hook must never mask the original error.
    }
  }

  private async reportFailure(error: unknown, context: ErrorContext): Promise<void> {
    this.emit("error", `${context.operation} failed`, {
      ...context,
      ...(error instanceof Error ? { error: { name: error.name, message: error.message } } : {}),
    });
    if (!isAbortError(error)) {
      await this.notifyError(error, context);
    }
  }
}

/** Returns a copy of `options` with `size` set, or removed when undefined. */
function withSize<T extends UploadOptions>(options: T, size: number | undefined): T {
  const { size: _stale, ...rest } = options;
  return (size === undefined ? rest : { ...rest, size }) as T;
}
