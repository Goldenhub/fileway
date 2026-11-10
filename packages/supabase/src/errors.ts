import type { StorageErrorCode } from "@fileway/core";

// Internal: error classification for SupabaseDriver. Not exported from the package.

/**
 * Classifies a Supabase Storage failure. The API often answers 400 with the
 * real status in the JSON body (`{ statusCode: "404", error, message }`), so
 * the body is checked before the HTTP status.
 */
export function classifySupabaseError(status: number, body: string): StorageErrorCode {
  let parsed: { statusCode?: string | number; error?: string; message?: string } = {};
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    // Not JSON (e.g. a TUS error); fall through to text and status checks.
  }
  const text = `${parsed.error ?? ""} ${parsed.message ?? ""} ${parsed.error === undefined ? body : ""}`.toLowerCase();
  const code = Number(parsed.statusCode ?? status);

  if (text.includes("bucket not found")) return "bucket-not-found";
  if (code === 409 || text.includes("already exists") || text.includes("duplicate")) return "conflict";
  if (text.includes("not found") || text.includes("not_found") || text.includes("no such")) return "not-found";
  if (text.includes("exceeded the maximum allowed size") || text.includes("payload too large") || code === 413) {
    return "size-exceeded";
  }
  if (code === 401 || code === 403 || text.includes("jwt") || text.includes("unauthorized") || text.includes("row-level security")) {
    return "auth-failed";
  }
  if (code === 429 || text.includes("too many requests")) return "rate-limited";
  if (code === 404) return "not-found";
  return "provider-error";
}
