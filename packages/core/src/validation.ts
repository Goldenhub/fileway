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

export function validateUploadOptions(options: {
  filename: string;
  path?: string;
  mimeType?: string;
  size?: number;
}): void {
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

export function urlEncodePath(path: string): string {
  return path.split("/").map((s) => encodeURIComponent(s)).join("/");
}
