import type { BaseDriver, PresignedUrlOptions, StorageErrorCode, StoredObject, UploadOptions, UploadResult } from "@fileway/core";
import { validateUploadOptions, ValidationError, urlEncodePath, abortError, isAbortError, StorageError } from "@fileway/core";
import { signedReadUrl, TokenSource } from "./auth.js";
import type { ServiceAccountKey } from "./auth.js";

const randomUUID = () => globalThis.crypto.randomUUID();
const PROVIDER = "gcs";
const DEFAULT_ENDPOINT = "https://storage.googleapis.com";

// Resumable upload chunks must be multiples of 256 KiB (except the last).
const CHUNK_UNIT = 256 * 1024;
const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;
const PRESIGN_DEFAULT_EXPIRY = 3600;
// V4 signed URLs are capped at 7 days.
const PRESIGN_MIN_EXPIRY = 1;
const PRESIGN_MAX_EXPIRY = 604800;
// Custom object metadata key carrying FilewayClient's per-upload token.
const TOKEN_KEY = "fileway-upload-token";
// How many times a chunk is resent when the server persisted only part of it.
const MAX_CHUNK_RESENDS = 3;

/** The fields of a service account JSON key file this driver uses. */
export interface ServiceAccountJson {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface GCSDriverConfig {
  bucket: string;
  /** Service account email and PEM private key. */
  credentials?: { clientEmail: string; privateKey: string };
  /** A service account JSON key, as an object or the raw file contents. */
  serviceAccount?: string | ServiceAccountJson;
  /** Supplies an OAuth access token instead of a key (Workload Identity, the
   * metadata server, `gcloud auth print-access-token`, ...). Presigned URLs
   * need `credentials` or `serviceAccount`. */
  getAccessToken?: () => Promise<string>;
  /** API endpoint. Default `https://storage.googleapis.com`; set it for an
   * emulator such as fake-gcs-server. */
  endpoint?: string;
  /** Public base URL for `getUrl` (e.g. a CDN). Default `<endpoint>/<bucket>`. */
  baseUrl?: string;
  /** Resumable upload chunk size in bytes. Default 8 MiB, rounded down to a
   * multiple of 256 KiB. Also the largest upload sent as a single request. */
  chunkSize?: number;
  /** Reject uploads larger than this many bytes with a `size-exceeded` error. */
  maxSizeBytes?: number;
}

export type GCSMeta = {
  bucket: string;
  generation?: string;
  md5Hash?: string;
  etag?: string;
};

/** The object resource returned by the JSON API (fields this driver reads). */
interface GcsObject {
  name: string;
  size?: string;
  contentType?: string;
  generation?: string;
  md5Hash?: string;
  etag?: string;
  updated?: string;
  metadata?: Record<string, string>;
}

export class GCSDriver implements BaseDriver<GCSMeta> {
  readonly name = "gcs";
  private bucket: string;
  private endpoint: string;
  private baseUrl: string;
  private chunkSize: number;
  private maxSizeBytes: number | undefined;
  private account: ServiceAccountKey | undefined;
  private tokens: TokenSource | undefined;
  private getAccessToken: (() => Promise<string>) | undefined;

  constructor(config: GCSDriverConfig) {
    if (!config.bucket) throw new StorageError("config", "GCSDriver requires a bucket", { provider: PROVIDER });
    this.account = resolveAccount(config);
    if (this.account) this.tokens = new TokenSource(this.account);
    this.getAccessToken = config.getAccessToken;
    if (!this.tokens && !this.getAccessToken) {
      throw new StorageError("config", "GCSDriver requires credentials, serviceAccount or getAccessToken", {
        provider: PROVIDER,
      });
    }

    this.bucket = config.bucket;
    this.endpoint = (config.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
    this.baseUrl = (config.baseUrl ?? `${this.endpoint}/${config.bucket}`).replace(/\/+$/, "");
    const requested = config.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.chunkSize = Math.max(CHUNK_UNIT, Math.floor(requested / CHUNK_UNIT) * CHUNK_UNIT);
    this.maxSizeBytes = config.maxSizeBytes;
  }

  async upload(stream: ReadableStream<Uint8Array>, options: UploadOptions): Promise<UploadResult<GCSMeta>> {
    validateUploadOptions(options);
    if (this.maxSizeBytes !== undefined && options.size !== undefined && options.size > this.maxSizeBytes) {
      throw new StorageError("size-exceeded", `file size ${options.size} exceeds maxSizeBytes ${this.maxSizeBytes}`, { provider: PROVIDER });
    }

    const id = options.id ?? randomUUID();
    const name = this.pathFor({ ...options, id });
    const resource = {
      name,
      contentType: options.mimeType ?? "application/octet-stream",
      metadata: {
        ...options.metadata,
        ...(options.uploadToken ? { [TOKEN_KEY]: options.uploadToken } : {}),
      },
    };
    const signal = options.signal;

    // Read one chunk at a time, so peak memory is bounded by `chunkSize`.
    const reader = stream.getReader();
    let aborted = signal?.aborted ?? false;
    const onAbort = () => {
      aborted = true;
      // Cancelling the reader wakes any pending `read()` with `done: true`.
      reader.cancel().catch(() => {});
    };
    if (signal && !aborted) signal.addEventListener("abort", onAbort, { once: true });

    let session: string | undefined;
    const cancelSession = async () => {
      if (!session) return;
      try {
        await fetch(session, { method: "DELETE" });
      } catch {
        // Best-effort cleanup; the original error is the important one.
      }
    };

    let buffer: Uint8Array[] = [];
    let bufferedLen = 0;
    let totalBytes = 0;
    let sentBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (aborted) throw abortError("upload aborted");
        if (done) break;
        totalBytes += value.byteLength;
        if (this.maxSizeBytes !== undefined && totalBytes > this.maxSizeBytes) {
          throw new StorageError("size-exceeded", `upload exceeds maxSizeBytes ${this.maxSizeBytes}`, { provider: PROVIDER });
        }
        buffer.push(value);
        bufferedLen += value.byteLength;

        // Send only once more than a chunk is buffered, so the final request
        // always carries data and can declare the total size.
        while (bufferedLen > this.chunkSize) {
          session ??= await this.startSession(resource, signal);
          const merged = concatBytes(buffer, bufferedLen);
          await this.sendChunk(session, merged.subarray(0, this.chunkSize), sentBytes, undefined, signal);
          sentBytes += this.chunkSize;
          const rest = merged.subarray(this.chunkSize);
          buffer = [rest];
          bufferedLen = rest.byteLength;
        }
      }

      if (options.size !== undefined && totalBytes !== options.size) {
        throw new ValidationError(`stream delivered ${totalBytes} bytes, expected ${options.size}`);
      }

      const last = concatBytes(buffer, bufferedLen);
      const object = session
        ? await this.sendChunk(session, last, sentBytes, totalBytes, signal)
        : await this.multipartUpload(resource, last, signal);
      if (!object) {
        throw new StorageError("provider-error", "GCS upload finished without an object resource", { provider: PROVIDER });
      }
      return { ...this.toResult(object), id };
    } catch (err) {
      reader.cancel().catch(() => {});
      await cancelSession();
      throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** Uploads a file that fits in one chunk as a single `multipart/related` request. */
  private async multipartUpload(
    resource: { name: string; contentType: string; metadata: Record<string, string> },
    bytes: Uint8Array,
    signal: AbortSignal | undefined,
  ): Promise<GcsObject> {
    const boundary = `fileway-${randomUUID()}`;
    const encoder = new TextEncoder();
    const head = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(resource)}\r\n` +
        `--${boundary}\r\nContent-Type: ${resource.contentType}\r\n\r\n`,
    );
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
    const body = concatBytes([head, bytes, tail], head.byteLength + bytes.byteLength + tail.byteLength);

    const res = await fetchWithAbort(`${this.endpoint}/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=multipart`, {
      method: "POST",
      headers: { ...(await this.authHeaders()), "content-type": `multipart/related; boundary=${boundary}` },
      body: body as BodyInit,
      signal: signal ?? null,
    });
    if (!res.ok) throw await gcsError("GCS upload failed", res);
    return (await res.json()) as GcsObject;
  }

  /** Starts a resumable upload session and returns its session URI. */
  private async startSession(
    resource: { name: string; contentType: string; metadata: Record<string, string> },
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const res = await fetchWithAbort(`${this.endpoint}/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=resumable`, {
      method: "POST",
      headers: {
        ...(await this.authHeaders()),
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": resource.contentType,
      },
      body: JSON.stringify(resource),
      signal: signal ?? null,
    });
    if (!res.ok) throw await gcsError("GCS resumable session failed", res);
    const location = res.headers.get("location");
    if (!location) {
      throw new StorageError("provider-error", "GCS resumable session returned no Location header", { provider: PROVIDER });
    }
    return location;
  }

  /**
   * PUTs `bytes` at offset `start` of the session. With `total`, this is the
   * final chunk and the object resource is returned; otherwise the server
   * answers 308 and any part it did not persist is sent again.
   */
  private async sendChunk(
    session: string,
    bytes: Uint8Array,
    start: number,
    total: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<GcsObject | undefined> {
    let offset = 0;
    for (let attempt = 0; attempt <= MAX_CHUNK_RESENDS; attempt++) {
      const part = bytes.subarray(offset);
      const from = start + offset;
      const range =
        part.byteLength === 0
          ? `bytes */${total ?? "*"}`
          : `bytes ${from}-${from + part.byteLength - 1}/${total ?? "*"}`;
      const res = await fetchWithAbort(session, {
        method: "PUT",
        headers: { ...(await this.authHeaders()), "content-range": range },
        body: part as BodyInit,
        signal: signal ?? null,
      });
      if (res.status === 200 || res.status === 201) return (await res.json()) as GcsObject;
      if (res.status !== 308) throw await gcsError("GCS chunk upload failed", res);

      // `Range: bytes=0-N` is how much of the object the server has so far.
      const persisted = Number(res.headers.get("range")?.match(/bytes=0-(\d+)/)?.[1] ?? -1) + 1;
      const wanted = start + bytes.byteLength;
      if (total === undefined && persisted >= wanted) return undefined;
      if (persisted < start) break;
      offset = Math.min(persisted - start, bytes.byteLength);
    }
    throw new StorageError("provider-error", "GCS did not persist the uploaded chunk", { provider: PROVIDER });
  }

  async delete(path: string): Promise<boolean> {
    const res = await fetchWithAbort(this.objectUrl(path), { method: "DELETE", headers: await this.authHeaders() });
    if (res.ok) return true;
    const error = await gcsError("GCS delete failed", res);
    if (error.code === "not-found") return false;
    throw error;
  }

  async getUrl(path: string): Promise<string> {
    return `${this.baseUrl}/${urlEncodePath(path)}`;
  }

  async get(path: string): Promise<ReadableStream<Uint8Array>> {
    const res = await fetchWithAbort(`${this.objectUrl(path)}?alt=media`, { headers: await this.authHeaders() });
    if (!res.ok) throw await gcsError("GCS get failed", res);
    if (!res.body) {
      throw new StorageError("provider-error", "GCS get returned no response body", { provider: PROVIDER });
    }
    return res.body;
  }

  /**
   * A V4 signed GET URL for `path`, valid for `expiresIn` seconds (integer in
   * 1..604800, default 3600). Needs `credentials` or `serviceAccount`.
   */
  async getPresignedUrl(path: string, options?: PresignedUrlOptions): Promise<string> {
    const expiresIn = options?.expiresIn ?? PRESIGN_DEFAULT_EXPIRY;
    if (!Number.isInteger(expiresIn) || expiresIn < PRESIGN_MIN_EXPIRY || expiresIn > PRESIGN_MAX_EXPIRY) {
      throw new ValidationError(
        `expiresIn must be an integer between ${PRESIGN_MIN_EXPIRY} and ${PRESIGN_MAX_EXPIRY} seconds`,
      );
    }
    if (!this.account || !this.tokens) {
      throw new StorageError("config", "GCSDriver needs credentials or serviceAccount to create presigned URLs", {
        provider: PROVIDER,
      });
    }
    return signedReadUrl({
      origin: this.endpoint,
      bucket: this.bucket,
      objectName: path,
      clientEmail: this.account.clientEmail,
      key: await this.tokens.signingKey(),
      expiresIn,
      now: new Date(),
    });
  }

  /** The object name an upload with `options.id` is stored under: `<path>/<id>.<ext>`. */
  pathFor(options: UploadOptions & { id: string }): string {
    const ext = options.filename.includes(".") ? options.filename.split(".").pop()! : "";
    const filename = ext ? `${options.id}.${ext}` : options.id;
    return options.path ? `${options.path}/${filename}` : filename;
  }

  /** The object at `path` (its JSON metadata), or `null` if it does not exist. */
  async head(path: string): Promise<StoredObject<GCSMeta> | null> {
    const res = await fetchWithAbort(this.objectUrl(path), { headers: await this.authHeaders() });
    if (!res.ok) {
      const error = await gcsError("GCS head failed", res);
      if (error.code === "not-found") return null;
      throw error;
    }
    const object = (await res.json()) as GcsObject;
    const name = path.split("/").pop() ?? path;
    const token = object.metadata?.[TOKEN_KEY];
    return {
      ...this.toResult(object),
      id: name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name,
      ...(token ? { uploadToken: token } : {}),
      ...(object.updated ? { lastModified: new Date(object.updated) } : {}),
      ...(object.contentType ? { contentType: object.contentType } : {}),
    };
  }

  private toResult(object: GcsObject): UploadResult<GCSMeta> {
    const name = object.name.split("/").pop() ?? object.name;
    return {
      id: name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name,
      url: `${this.baseUrl}/${urlEncodePath(object.name)}`,
      path: object.name,
      size: Number(object.size ?? 0),
      meta: {
        bucket: this.bucket,
        ...(object.generation ? { generation: object.generation } : {}),
        ...(object.md5Hash ? { md5Hash: object.md5Hash } : {}),
        ...(object.etag ? { etag: object.etag } : {}),
      },
    };
  }

  private objectUrl(path: string): string {
    return `${this.endpoint}/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(path)}`;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = this.getAccessToken ? await this.getAccessToken() : await this.tokens!.token();
    return { authorization: `Bearer ${token}` };
  }
}

function resolveAccount(config: GCSDriverConfig): ServiceAccountKey | undefined {
  if (config.credentials) return config.credentials;
  if (!config.serviceAccount) return undefined;
  let json: ServiceAccountJson;
  try {
    json = typeof config.serviceAccount === "string"
      ? (JSON.parse(config.serviceAccount) as ServiceAccountJson)
      : config.serviceAccount;
  } catch (cause) {
    throw new StorageError("config", "GCSDriver serviceAccount is not valid JSON", { provider: PROVIDER, cause: cause as Error });
  }
  if (!json.client_email || !json.private_key) {
    throw new StorageError("config", "GCSDriver serviceAccount needs client_email and private_key", { provider: PROVIDER });
  }
  return {
    clientEmail: json.client_email,
    privateKey: json.private_key,
    ...(json.token_uri ? { tokenUri: json.token_uri } : {}),
  };
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
  if (status === 413) return "size-exceeded";
  return "provider-error";
}

async function gcsError(prefix: string, res: Response): Promise<StorageError> {
  const body = await res.text().catch(() => "");
  return new StorageError(
    classifyGcsError(res.status, body),
    `${prefix}: ${res.status} ${res.statusText}${body ? `: ${body}` : ""}`,
    { statusCode: res.status, provider: PROVIDER },
  );
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
