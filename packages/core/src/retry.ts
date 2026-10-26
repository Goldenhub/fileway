import { isAbortError, StorageError } from "./errors.js";
import type { RetryConfig } from "./types.js";

/** Error codes whose failures are safe to retry (transient by nature). */
const RETRYABLE_CODES = new Set(["network", "provider-error"]);

/**
 * True when `err` may be worth retrying. Retryable codes are `network` and
 * `provider-error`, plus any `StorageError` (or plain error) carrying an HTTP
 * status of 429 or 5xx. Validation, config, auth, not-found, size, and abort
 * errors are never retried.
 */
export function isRetryable(err: unknown, config?: RetryConfig): boolean {
  if (isAbortError(err)) return false;

  if (err instanceof StorageError) {
    if (RETRYABLE_CODES.has(err.code)) return true;
    const status = err.statusCode;
    if (status === 429 || (status !== undefined && status >= 500)) return true;
    if (status !== undefined && config?.retryHttpStatuses?.includes(status)) return true;
    return false;
  }

  // Non-StorageError failures: by default only a `TypeError` (what `fetch`
  // throws on a network failure) is retried, so a bug in user code such as
  // middleware surfaces immediately instead of after several backoffs.
  return config?.retryGenericErrors ?? err instanceof TypeError;
}

/** Resolves after `ms` milliseconds, unless `signal` aborts first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError("aborted while waiting to retry"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError("aborted while waiting to retry"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Computes the delay (ms) before the attempt at 1-based `attempt`. Uses
 * exponential backoff with optional full jitter, capped at `maxDelayMs`.
 */
export function delayWithJitter(attempt: number, config: RetryConfig): number {
  const base = config.baseDelayMs ?? 300;
  const max = config.maxDelayMs ?? 10_000;
  const multiplier = config.multiplier ?? 2;
  const jitter = config.jitter ?? true;

  const cap = base * Math.pow(multiplier, attempt - 1);
  const bounded = Math.min(cap, max);

  if (!jitter) return Math.round(bounded);

  // Full jitter: uniform in [0, bounded] so the burst doesn't fan out in lockstep.
  return Math.round(Math.random() * bounded);
}

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}
