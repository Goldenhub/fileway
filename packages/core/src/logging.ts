/** Log levels used by the optional `Logger`. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** The operation a FilewayClient call ran. */
export type Operation =
  | "upload"
  | "delete"
  | "get"
  | "getUrl"
  | "getPresignedUrl";

/**
 * Dependency-free logger contract. Every method is optional, so you can pass
 * a partial adapter, a Pino/Sentry/Datadog instance, or a plain function.
 * Adapt third-party loggers with a thin wrapper (see the Logging guide).
 */
export interface Logger {
  debug?(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

/** Context describing a failed operation, passed to `onError`. */
export interface ErrorContext {
  operation: Operation;
  /** Time the operation took (ms) before it threw. */
  durationMs: number;
  filename?: string;
  path?: string;
  mimeType?: string;
  size?: number;
}
