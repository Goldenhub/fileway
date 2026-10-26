export * from "./types.js";
export * from "./validation.js";
export * from "./progress.js";
export * from "./errors.js";
export * from "./logging.js";
export * from "./retry.js";

// Replaced with the package.json version at build time (see tsup.config.ts).
declare const __FILEWAY_VERSION__: string | undefined;
export const version: string = typeof __FILEWAY_VERSION__ === "string" ? __FILEWAY_VERSION__ : "0.0.0-dev";

import { BaseDriver, FilewayConfig, OperationOptions, PresignedUrlOptions, RetryConfig, UploadOptions } from "./types.js";
import { withProgress } from "./progress.js";
import { StorageError, isAbortError } from "./errors.js";
import { abortError } from "./validation.js";
import { delayWithJitter, isRetryable, sleep } from "./retry.js";
import type { ErrorContext, Logger, LogLevel, Operation } from "./logging.js";

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

    let attempt = 1;
    let activeOptions = { ...options };

    this.emit("info", "upload started", {
      operation: "upload",
      ...(options.filename !== undefined ? { filename: options.filename } : {}),
      ...(options.path !== undefined ? { path: options.path } : {}),
      ...(options.mimeType !== undefined ? { mimeType: options.mimeType } : {}),
      ...(options.size !== undefined ? { size: options.size } : {}),
    });

    for (;;) {
      // Every attempt starts from the caller's original options, so
      // `beforeUpload` middleware never transforms its own earlier output.
      let activeStream = attempt === 1 ? stream : options.streamFactory!();
      activeOptions = { ...options };

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

        const progressStream = activeOptions.onProgress
          ? withProgress(activeStream, activeOptions.onProgress, activeOptions.size)
          : activeStream;

        const uploadResult = await this.driver.upload(progressStream, activeOptions);

        for (const middleware of this.middlewares) {
          if (middleware.afterUpload) {
            await middleware.afterUpload(uploadResult);
          }
        }

        this.emit("info", "upload succeeded", {
          operation: "upload",
          id: uploadResult.id,
          url: uploadResult.url,
          path: uploadResult.path,
          size: uploadResult.size,
          durationMs: Date.now() - started,
        });

        return uploadResult as ReturnType<TConfig["driver"]["upload"]>;
      } catch (error) {
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
    operation: "delete" | "getUrl" | "get" | "getPresignedUrl",
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
        const result = await fn();
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
