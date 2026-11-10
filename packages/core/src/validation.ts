import { StorageError } from "./errors.js";

export class ValidationError extends StorageError {
  constructor(message: string) {
    super("validation", message);
    this.name = "ValidationError";
  }
}

/** Returns a standard `DOMException` with `name === "AbortError"`, the same
 * error `fetch` throws when its signal aborts. Callers can detect cancellation
 * with `error.name === "AbortError"` regardless of driver. */
export function abortError(message = "operation aborted"): DOMException {
  return new DOMException(message, "AbortError");
}

const UPLOAD_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Throws a `ValidationError` unless `id` is 1 to 128 characters of `A-Za-z0-9_-`. */
export function validateUploadId(id: string): void {
  if (!UPLOAD_ID.test(id)) {
    throw new ValidationError("id must be 1 to 128 characters of A-Z, a-z, 0-9, _ or -");
  }
}

export function validateUploadOptions(options: {
  filename: string;
  path?: string;
  mimeType?: string;
  size?: number;
  id?: string;
}): void {
  if (options.id !== undefined) validateUploadId(options.id);
  if (!options.filename || typeof options.filename !== "string") {
    throw new ValidationError("filename is required and must be a string");
  }
  if (options.filename.length > 255) {
    throw new ValidationError("filename must not exceed 255 characters");
  }
  if (
    options.filename.includes("/") ||
    options.filename.includes("\\") ||
    options.filename.includes("\0")
  ) {
    throw new ValidationError("filename must not contain path separators or null bytes");
  }
  if (options.path) {
    if (options.path.includes("\0")) {
      throw new ValidationError("path must not contain null bytes");
    }
    if (options.path.startsWith("/")) {
      throw new ValidationError("path must be relative");
    }
  }
  if (options.mimeType && !/^[a-zA-Z0-9!#$%^&*_\-+.]+\/[a-zA-Z0-9!#$%^&*_\-+.]+$/.test(options.mimeType)) {
    throw new ValidationError("mimeType must be a valid MIME type");
  }
  if (options.size !== undefined) {
    if (!Number.isInteger(options.size) || options.size < 0) {
      throw new ValidationError("size must be a non-negative integer");
    }
  }
}

/**
 * Throws a `ValidationError` unless `path` names one object: non-empty,
 * relative, without null bytes, `..` segments or a trailing "/".
 */
export function validateObjectPath(path: string, name = "path"): void {
  if (!path || typeof path !== "string") throw new ValidationError(`${name} is required and must be a string`);
  if (path.endsWith("/")) throw new ValidationError(`${name} must name a file, not a folder`);
  validatePrefix(path, name);
}

/** Like `validateObjectPath`, but allows "" (the root) and a trailing "/". */
export function validatePrefix(prefix: string, name = "prefix"): void {
  if (typeof prefix !== "string") throw new ValidationError(`${name} must be a string`);
  if (prefix.includes("\0")) throw new ValidationError(`${name} must not contain null bytes`);
  if (prefix.startsWith("/")) throw new ValidationError(`${name} must be relative`);
  if (prefix.split("/").some((segment) => segment === "..")) {
    throw new ValidationError(`${name} must not contain ".." segments`);
  }
}

/** Encodes a driver's list position as an opaque, URL-safe cursor. */
export function encodeCursor(value: unknown): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(JSON.stringify(value))) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decodes a cursor made by `encodeCursor`; throws a `ValidationError` for anything else. */
export function decodeCursor<T>(cursor: string): T {
  try {
    const binary = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new ValidationError("cursor is not valid; pass back the cursor from the previous page unchanged");
  }
}

export function urlEncodePath(path: string): string {
  return path.split("/").map((s) => encodeURIComponent(s)).join("/");
}
