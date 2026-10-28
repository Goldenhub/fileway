import type { BaseDriver, PresignedUrlOptions, StorageErrorCode, StoredObject, UploadOptions, UploadResult } from "@fileway/core";
import { validateUploadOptions, ValidationError, urlEncodePath, abortError, isAbortError, StorageError } from "@fileway/core";

const randomUUID = () => globalThis.crypto.randomUUID();
const PROVIDER = "supabase";

// Supabase's resumable (TUS) endpoint requires 6 MiB chunks.
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
const TUS_VERSION = "1.0.0";
const PRESIGN_DEFAULT_EXPIRY = 3600;
// User metadata key carrying FilewayClient's per-upload token.
const TOKEN_KEY = "fileway-upload-token";
// How many times a TUS chunk is resent when the server stored only part of it.
const MAX_CHUNK_RESENDS = 3;

export interface SupabaseDriverConfig {
  /** Project URL, e.g. `https://<ref>.supabase.co` (or the direct storage host
   * `https://<ref>.storage.supabase.co`, recommended for large uploads). */
  url: string;
  /** API key: a secret / service role key on the server, or the anon or
   * publishable key together with `accessToken`. */
  key: string;
  /** A signed-in user's JWT, so the bucket's RLS policies apply. */
  accessToken?: string;
  bucket: string;
  /** Public base URL for `getUrl`. Defaults to the bucket's public object URL. */
  baseUrl?: string;
  /** Reject uploads larger than this many bytes with a `size-exceeded` error. */
  maxSizeBytes?: number;
  /** `Cache-Control` max-age in seconds for uploaded objects. Default 3600. */
  cacheControl?: number;
}

export type SupabaseMeta = {
  bucket: string;
  etag?: string;
};

/** The `GET /object/info` response (fields this driver reads). */
interface ObjectInfo {
  name?: string;
  size?: number | null;
  content_type?: string | null;
  etag?: string | null;
  last_modified?: string | null;
  metadata?: Record<string, string> | null;
}

export class SupabaseDriver implements BaseDriver<SupabaseMeta> {
  readonly name = "supabase";
  private api: string;
  private bucket: string;
  private baseUrl: string;
  private headers: Record<string, string>;
  private maxSizeBytes: number | undefined;
  private cacheControl: string;

  constructor(config: SupabaseDriverConfig) {
    if (!config.url || !config.key || !config.bucket) {
      throw new StorageError("config", "SupabaseDriver requires url, key and bucket", { provider: PROVIDER });
    }
    this.api = `${config.url.replace(/\/+$/, "")}/storage/v1`;
    this.bucket = config.bucket;
    this.baseUrl = (config.baseUrl ?? `${this.api}/object/public/${config.bucket}`).replace(/\/+$/, "");
    // New-style keys (sb_secret_..., sb_publishable_...) are not JWTs and go
    // only in `apikey`; legacy JWT keys and user tokens also go in Authorization.
    const bearer = config.accessToken ?? (config.key.startsWith("eyJ") ? config.key : undefined);
    this.headers = { apikey: config.key, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) };
    this.maxSizeBytes = config.maxSizeBytes;
    this.cacheControl = `max-age=${config.cacheControl ?? 3600}`;
  }

  async upload(stream: ReadableStream<Uint8Array>, options: UploadOptions): Promise<UploadResult<SupabaseMeta>> {
    validateUploadOptions(options);
    if (this.maxSizeBytes !== undefined && options.size !== undefined && options.size > this.maxSizeBytes) {
      throw new StorageError("size-exceeded", `file size ${options.size} exceeds maxSizeBytes ${this.maxSizeBytes}`, { provider: PROVIDER });
    }

    const id = options.id ?? randomUUID();
    const path = this.pathFor({ ...options, id });
    const contentType = options.mimeType ?? "application/octet-stream";
    const metadata = { ...options.metadata, ...(options.uploadToken ? { [TOKEN_KEY]: options.uploadToken } : {}) };
    const signal = options.signal;

    const reader = stream.getReader();
    let aborted = signal?.aborted ?? false;
    const onAbort = () => {
      aborted = true;
      // Cancelling the reader wakes any pending `read()` with `done: true`.
      reader.cancel().catch(() => {});
    };
    if (signal && !aborted) signal.addEventListener("abort", onAbort, { once: true });

    let totalBytes = 0;
    const read = async (): Promise<Uint8Array | undefined> => {
      const { done, value } = await reader.read();
      if (aborted) throw abortError("upload aborted");
      if (done) return undefined;
      totalBytes += value.byteLength;
      if (this.maxSizeBytes !== undefined && totalBytes > this.maxSizeBytes) {
        throw new StorageError("size-exceeded", `upload exceeds maxSizeBytes ${this.maxSizeBytes}`, { provider: PROVIDER });
      }
      return value;
    };
    const checkSize = () => {
      if (options.size !== undefined && totalBytes !== options.size) {
        throw new ValidationError(`stream delivered ${totalBytes} bytes, expected ${options.size}`);
      }
    };

    let tusUrl: string | undefined;
    try {
      let etag: string | undefined;

      if (options.size !== undefined && options.size > TUS_CHUNK_SIZE) {
        // Known large size: resumable TUS upload, one 6 MiB chunk in memory at a time.
        tusUrl = await this.createTusUpload(path, options.size, contentType, metadata, signal);
        let buffer: Uint8Array[] = [];
        let bufferedLen = 0;
        let offset = 0;
        while (true) {
          const value = await read();
          if (totalBytes > options.size) checkSize();
          if (value) {
            buffer.push(value);
            bufferedLen += value.byteLength;
          }
          while (bufferedLen >= TUS_CHUNK_SIZE || (!value && bufferedLen > 0)) {
            if (!value) checkSize();
            const merged = concatBytes(buffer, bufferedLen);
            const take = Math.min(TUS_CHUNK_SIZE, bufferedLen);
            offset = await this.patchTus(tusUrl, merged.subarray(0, take), offset, signal);
            const rest = merged.subarray(take);
            buffer = [rest];
            bufferedLen = rest.byteLength;
          }
          if (!value) break;
        }
        checkSize();
      } else {
        // Read the first chunk; if the stream ends inside it, send one buffered request.
        const first: Uint8Array[] = [];
        let firstLen = 0;
        let ended = false;
        while (firstLen <= TUS_CHUNK_SIZE) {
          const value = await read();
          if (!value) {
            ended = true;
            break;
          }
          first.push(value);
          firstLen += value.byteLength;
        }
        const head = concatBytes(first, firstLen);

        if (ended) {
          checkSize();
          etag = await this.standardUpload(path, head, contentType, metadata, signal);
        } else {
          // A declared size this small cannot be followed by more data.
          checkSize();
          // Unknown size beyond one chunk: stream the rest in a single request,
          // so memory stays bounded without knowing the total in advance.
          const bodyError: { current?: unknown } = {};
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(head);
            },
            async pull(controller) {
              try {
                const value = await read();
                if (value) controller.enqueue(value);
                else controller.close();
              } catch (err) {
                bodyError.current = err;
                controller.error(err);
              }
            },
            cancel(reason) {
              return reader.cancel(reason);
            },
          });
          try {
            etag = await this.standardUpload(path, body, contentType, metadata, signal);
          } catch (err) {
            // A body error (abort, size limit) surfaces as a generic fetch failure.
            if (bodyError.current) throw bodyError.current;
            throw err;
          }
          checkSize();
        }
      }

      return {
        id,
        url: `${this.baseUrl}/${urlEncodePath(path)}`,
        path,
        size: totalBytes,
        meta: { bucket: this.bucket, ...(etag ? { etag } : {}) },
      };
    } catch (err) {
      reader.cancel().catch(() => {});
      if (tusUrl) {
        // Best-effort: terminate the unfinished TUS upload.
        await fetch(tusUrl, { method: "DELETE", headers: { ...this.headers, "tus-resumable": TUS_VERSION } }).catch(() => {});
      }
      throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** `POST /object/{bucket}/{path}`, overwriting any existing object. */
  private async standardUpload(
    path: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    contentType: string,
    metadata: Record<string, string>,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    const res = await fetchWithAbort(this.objectUrl("object", path), {
      method: "POST",
      headers: {
        ...this.headers,
        "content-type": contentType,
        "cache-control": this.cacheControl,
        "x-upsert": "true",
        "x-metadata": base64(JSON.stringify(metadata)),
      },
      body: body as BodyInit,
      // Node's fetch (undici) requires `duplex: "half"` for stream bodies;
      // other runtimes ignore it.
      duplex: "half",
      signal: signal ?? null,
    } as RequestInit);
    if (!res.ok) throw await supabaseError("Supabase upload failed", res);
    return res.headers.get("etag") ?? undefined;
  }

  /** Creates a TUS upload and returns its URL. */
  private async createTusUpload(
    path: string,
    size: number,
    contentType: string,
    metadata: Record<string, string>,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const endpoint = `${this.api}/upload/resumable`;
    const uploadMetadata = {
      bucketName: this.bucket,
      objectName: path,
      contentType,
      cacheControl: this.cacheControl.replace("max-age=", ""),
      metadata: JSON.stringify(metadata),
    };
    const res = await fetchWithAbort(endpoint, {
      method: "POST",
      headers: {
        ...this.headers,
        "tus-resumable": TUS_VERSION,
        "upload-length": String(size),
        "upload-metadata": Object.entries(uploadMetadata)
          .map(([k, v]) => `${k} ${base64(v)}`)
          .join(","),
        "x-upsert": "true",
      },
      signal: signal ?? null,
    });
    if (!res.ok) throw await supabaseError("Supabase resumable upload create failed", res);
    const location = res.headers.get("location");
    if (!location) {
      throw new StorageError("provider-error", "Supabase resumable upload returned no Location header", { provider: PROVIDER });
    }
    return new URL(location, endpoint).href;
  }

  /** PATCHes `bytes` at `offset`, resending whatever the server did not store.
   * Returns the new offset. */
  private async patchTus(url: string, bytes: Uint8Array, offset: number, signal: AbortSignal | undefined): Promise<number> {
    const end = offset + bytes.byteLength;
    let current = offset;
    for (let attempt = 0; attempt <= MAX_CHUNK_RESENDS && current < end; attempt++) {
      const res = await fetchWithAbort(url, {
        method: "PATCH",
        headers: {
          ...this.headers,
          "tus-resumable": TUS_VERSION,
          "upload-offset": String(current),
          "content-type": "application/offset+octet-stream",
        },
        body: bytes.subarray(current - offset) as BodyInit,
        signal: signal ?? null,
      });
      if (!res.ok) throw await supabaseError("Supabase resumable upload chunk failed", res);
      const next = Number(res.headers.get("upload-offset") ?? end);
      if (next < current) break;
      current = next;
    }
    if (current < end) {
      throw new StorageError("provider-error", "Supabase did not store the uploaded chunk", { provider: PROVIDER });
    }
    return current;
  }

  async delete(path: string): Promise<boolean> {
    const res = await fetchWithAbort(`${this.api}/object/${encodeURIComponent(this.bucket)}`, {
      method: "DELETE",
      headers: { ...this.headers, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: [path] }),
    });
    if (!res.ok) throw await supabaseError("Supabase delete failed", res);
    const removed = (await res.json().catch(() => [])) as unknown[];
    return Array.isArray(removed) && removed.length > 0;
  }

  async getUrl(path: string): Promise<string> {
    return `${this.baseUrl}/${urlEncodePath(path)}`;
  }

  async get(path: string): Promise<ReadableStream<Uint8Array>> {
    const res = await fetchWithAbort(this.objectUrl("object/authenticated", path), { headers: this.headers });
    if (!res.ok) throw await supabaseError("Supabase get failed", res);
    if (!res.body) {
      throw new StorageError("provider-error", "Supabase get returned no response body", { provider: PROVIDER });
    }
    return res.body;
  }

  /** A signed download URL for `path`, valid for `expiresIn` seconds (positive integer, default 3600). */
  async getPresignedUrl(path: string, options?: PresignedUrlOptions): Promise<string> {
    const expiresIn = options?.expiresIn ?? PRESIGN_DEFAULT_EXPIRY;
    if (!Number.isInteger(expiresIn) || expiresIn < 1) {
      throw new ValidationError("expiresIn must be a positive integer number of seconds");
    }
    const res = await fetchWithAbort(this.objectUrl("object/sign", path), {
      method: "POST",
      headers: { ...this.headers, "content-type": "application/json" },
      body: JSON.stringify({ expiresIn }),
    });
    if (!res.ok) throw await supabaseError("Supabase sign failed", res);
    const { signedURL } = (await res.json()) as { signedURL?: string };
    if (!signedURL) {
      throw new StorageError("provider-error", "Supabase sign returned no signedURL", { provider: PROVIDER });
    }
    return `${this.api}${signedURL.startsWith("/") ? "" : "/"}${signedURL}`;
  }

  /** The object name an upload with `options.id` is stored under: `<path>/<id>.<ext>`. */
  pathFor(options: UploadOptions & { id: string }): string {
    const ext = options.filename.includes(".") ? options.filename.split(".").pop()! : "";
    const filename = ext ? `${options.id}.${ext}` : options.id;
    return options.path ? `${options.path}/${filename}` : filename;
  }

  /** The object at `path` (`GET /object/info`), or `null` if it does not exist. */
  async head(path: string): Promise<StoredObject<SupabaseMeta> | null> {
    const res = await fetchWithAbort(this.objectUrl("object/info", path), { headers: this.headers });
    if (!res.ok) {
      const error = await supabaseError("Supabase info failed", res);
      if (error.code === "not-found") return null;
      throw error;
    }
    const info = (await res.json()) as ObjectInfo;
    const name = path.split("/").pop() ?? path;
    const token = info.metadata?.[TOKEN_KEY];
    return {
      id: name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name,
      url: `${this.baseUrl}/${urlEncodePath(path)}`,
      path,
      size: Number(info.size ?? 0),
      meta: { bucket: this.bucket, ...(info.etag ? { etag: info.etag } : {}) },
      ...(token ? { uploadToken: token } : {}),
      ...(info.last_modified ? { lastModified: new Date(info.last_modified) } : {}),
      ...(info.content_type ? { contentType: info.content_type } : {}),
    };
  }

  private objectUrl(route: string, path: string): string {
    return `${this.api}/${route}/${encodeURIComponent(this.bucket)}/${urlEncodePath(path)}`;
  }
}

/** `fetch` that converts non-abort failures into a typed `network` error,
 * while letting aborts (`AbortError`) pass through untouched. */
async function fetchWithAbort(url: string | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (isAbortError(err)) throw err;
    const cause = err instanceof Error ? err : new Error(String(err));
    throw new StorageError("network", `${PROVIDER} network error: ${cause.message}`, { provider: PROVIDER, cause });
  }
}

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
  if (text.includes("not found") || text.includes("not_found") || text.includes("no such")) return "not-found";
  if (text.includes("exceeded the maximum allowed size") || text.includes("payload too large") || code === 413) {
    return "size-exceeded";
  }
  if (code === 401 || code === 403 || text.includes("jwt") || text.includes("unauthorized") || text.includes("row-level security")) {
    return "auth-failed";
  }
  if (code === 404) return "not-found";
  return "provider-error";
}

async function supabaseError(prefix: string, res: Response): Promise<StorageError> {
  const body = await res.text().catch(() => "");
  return new StorageError(
    classifySupabaseError(res.status, body),
    `${prefix}: ${res.status} ${res.statusText}${body ? `: ${body}` : ""}`,
    { statusCode: res.status, provider: PROVIDER },
  );
}

function base64(value: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
