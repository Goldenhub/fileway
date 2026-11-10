import type { StorageErrorCode } from "@fileway/core";

// Internal: error classification for GCSDriver. Not exported from the package.

/** Classifies a GCS failure from the JSON error body (`error.message`),
 * falling back to the HTTP status. */
export function classifyGcsError(status: number, body: string): StorageErrorCode {
  let message = "";
  try {
    message = ((JSON.parse(body) as { error?: { message?: string } }).error?.message ?? "").toLowerCase();
  } catch {
    message = body.toLowerCase();
  }
  if (status === 404) return message.includes("bucket") && !message.includes("no such object") ? "bucket-not-found" : "not-found";
  if (status === 401 || status === 403) return "auth-failed";
  if (status === 412) return "conflict";
  if (status === 413) return "size-exceeded";
  if (status === 429) return "rate-limited";
  return "provider-error";
}
