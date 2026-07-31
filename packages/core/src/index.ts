export * from "./types.js";
export * from "./validation.js";
export * from "./progress.js";
export * from "./errors.js";
export * from "./logging.js";

export const version = "0.0.1";

import { BaseDriver, FilewayConfig, PresignedUrlOptions, UploadOptions } from "./types.js";
import { withProgress } from "./progress.js";
import { StorageError, isAbortError } from "./errors.js";
import type { ErrorContext, Logger, LogLevel, Operation } from "./logging.js";

export class FilewayClient<const TConfig extends FilewayConfig<BaseDriver>> {
  private driver: TConfig["driver"];
  private middlewares: NonNullable<TConfig["middlewares"]>;
  private logger: Logger | undefined;
  private onError: ((error: unknown, context: ErrorContext) => void | Promise<void>) | undefined;

  constructor(config: TConfig) {
    this.driver = config.driver;
    this.middlewares = config.middlewares ?? [];
    this.logger = config.logger;
    this.onError = config.onError;
  }

  async upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
  ): Promise<ReturnType<TConfig["driver"]["upload"]>> {
    const started = Date.now();
    let activeStream = stream;
    let activeOptions = { ...options };

    this.emit("info", "upload started", {
      operation: "upload",
      ...(activeOptions.filename !== undefined ? { filename: activeOptions.filename } : {}),
      ...(activeOptions.path !== undefined ? { path: activeOptions.path } : {}),
      ...(activeOptions.mimeType !== undefined ? { mimeType: activeOptions.mimeType } : {}),
      ...(activeOptions.size !== undefined ? { size: activeOptions.size } : {}),
    });

    try {
      for (const middleware of this.middlewares) {
        if (middleware.beforeUpload) {
          const result = await middleware.beforeUpload(activeStream, activeOptions);
          if (result?.stream) activeStream = result.stream;
          if (result?.options) activeOptions = result.options;
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
  }

  async delete(path: string): Promise<boolean> {
    const started = Date.now();
    this.emit("info", "delete started", { operation: "delete", path });
    try {
      const result = await this.driver.delete(path);
      this.emit("info", "delete succeeded", { operation: "delete", path, durationMs: Date.now() - started });
      return result;
    } catch (error) {
      await this.reportFailure(error, { operation: "delete", durationMs: Date.now() - started, path });
      throw error;
    }
  }

  async getUrl(path: string): Promise<string> {
    const started = Date.now();
    this.emit("info", "getUrl started", { operation: "getUrl", path });
    try {
      const url = await this.driver.getUrl(path);
      this.emit("info", "getUrl succeeded", { operation: "getUrl", path, durationMs: Date.now() - started });
      return url;
    } catch (error) {
      await this.reportFailure(error, { operation: "getUrl", durationMs: Date.now() - started, path });
      throw error;
    }
  }

  async get(path: string): Promise<ReadableStream<Uint8Array>> {
    const started = Date.now();
    this.emit("info", "get started", { operation: "get", path });
    try {
      const stream = await this.driver.get(path);
      this.emit("info", "get succeeded", { operation: "get", path, durationMs: Date.now() - started });
      return stream;
    } catch (error) {
      await this.reportFailure(error, { operation: "get", durationMs: Date.now() - started, path });
      throw error;
    }
  }

  async getPresignedUrl(
    path: string,
    options?: PresignedUrlOptions,
  ): Promise<string> {
    const started = Date.now();
    this.emit("info", "getPresignedUrl started", { operation: "getPresignedUrl", path });
    try {
      if (!this.driver.getPresignedUrl) {
        throw new StorageError(
          "config",
          `driver ${this.driver.name} does not support presigned URLs`,
          { provider: this.driver.name },
        );
      }
      const url = await this.driver.getPresignedUrl(path, options);
      this.emit("info", "getPresignedUrl succeeded", { operation: "getPresignedUrl", path, durationMs: Date.now() - started });
      return url;
    } catch (error) {
      await this.reportFailure(error, { operation: "getPresignedUrl", durationMs: Date.now() - started, path });
      throw error;
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
