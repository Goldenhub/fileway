import { StorageError } from "./errors.js";

// Internal helpers for `RetryConfig.idleTimeoutMs`. Not exported from the package.

/** Calls `onTimeout` once if `touch()` is not called again within `ms`. */
export class IdleTimer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  fired = false;

  constructor(
    private readonly ms: number,
    private readonly onTimeout: () => void,
  ) {}

  touch(): void {
    if (this.fired) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.fired = true;
      this.onTimeout();
    }, this.ms);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/**
 * Passes the stream through unchanged, calling `onActivity` for every chunk
 * the driver reads and once more when the stream ends (the wait for the
 * provider's reply starts then).
 */
export function withActivity(
  stream: ReadableStream<Uint8Array>,
  onActivity: () => void,
): ReadableStream<Uint8Array> {
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        onActivity();
        controller.enqueue(chunk);
      },
      flush() {
        onActivity();
      },
    }),
  );
}

/** A signal that aborts when any of `signals` does, plus a cleanup for its listeners. */
export function linkSignals(...signals: (AbortSignal | undefined)[]): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const cleanups: (() => void)[] = [];
  for (const source of signals) {
    if (!source) continue;
    if (source.aborted) {
      controller.abort(source.reason);
      break;
    }
    const onAbort = () => controller.abort(source.reason);
    source.addEventListener("abort", onAbort, { once: true });
    cleanups.push(() => source.removeEventListener("abort", onAbort));
  }
  return { signal: controller.signal, dispose: () => cleanups.forEach((c) => c()) };
}

/**
 * Settles with `promise`, or rejects as soon as `signal` aborts, so a driver
 * that ignores its signal cannot hold the client forever. The abandoned
 * promise's eventual rejection is swallowed.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  promise.catch(() => {});
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Settles with `promise`, or rejects with a timeout error after `ms`. */
export function withTimeLimit<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  promise.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError(operation, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** The retryable error an attempt that made no progress is reported as. */
export function timeoutError(operation: string, ms: number, cause?: unknown): StorageError {
  return new StorageError("network", `${operation} attempt timed out after ${ms} ms without progress`, {
    ...(cause !== undefined ? { cause } : {}),
  });
}
