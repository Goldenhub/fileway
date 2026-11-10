import type { BaseDriver, DriverCapabilities, GetOptions, CopyOptions, ListedObject, ListOptions, ListPage, OperationOptions, PresignedUrlOptions, StoredObject, UploadContext, UploadOptions, UploadResult } from "@fileway/core";
import { validateUploadOptions, ValidationError, urlEncodePath, abortError, isAbortError, StorageError, encodeCursor, decodeCursor } from "@fileway/core";
import { blobReadSas, bytesToBase64, signRequest, SERVICE_VERSION } from "./sharedkey.js";
import { classifyAzureError, parseConnectionString } from "./internal.js";

const randomUUID = () => globalThis.crypto.randomUUID();
const PROVIDER = "azure";

const DEFAULT_BLOCK_SIZE = 8 * 1024 * 1024;
const MIN_BLOCK_SIZE = 1024 * 1024;
// Put Block accepts up to 4000 MiB per block.
const MAX_BLOCK_SIZE = 4000 * 1024 * 1024;
// A block blob holds at most 50,000 committed blocks.
const MAX_BLOCKS = 50_000;
const PRESIGN_DEFAULT_EXPIRY = 3600;
const PRESIGN_MIN_EXPIRY = 1;
const PRESIGN_MAX_EXPIRY = 604800;
// Metadata names must be valid C# identifiers, so no hyphens here.
const TOKEN_KEY = "fileway_upload_token";
const TOKEN_HEADER = `x-ms-meta-${TOKEN_KEY}`;
const METADATA_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;


export interface AzureDriverConfig {
  /** Container to store blobs in. */
  container: string;
  /** Storage account name. Required unless a connection string provides it. */
  accountName?: string;
  /** Base64 account key, used for Shared Key auth and presigned URLs. */
  accountKey?: string;
  /** A SAS token (with or without the leading `?`), used instead of an account key. */
  sasToken?: string;
  /** An Azure Storage connection string, e.g. from the portal or
   * `UseDevelopmentStorage=true` for Azurite. Explicit fields override it. */
  connectionString?: string;
  /** Blob service endpoint. Defaults to `https://<account>.blob.core.windows.net`.
   * For Azurite: `http://127.0.0.1:10000/devstoreaccount1`. */
  endpoint?: string;
  /** Public base URL for `getUrl` (e.g. a CDN). Defaults to `<endpoint>/<container>`. */
  baseUrl?: string;
  /** Block size in bytes. Default 8 MiB, clamped to 1 MiB..4000 MiB. Also the
   * largest upload sent as a single Put Blob. */
  blockSize?: number;
  /** Reject uploads larger than this many bytes with a `size-exceeded` error. */
  maxSizeBytes?: number;
}

export type AzureMeta = {
  container: string;
  etag?: string;
};

interface ResolvedAuth {
  accountName: string;
  accountKey?: string;
  sasToken?: string;
}

export class AzureDriver implements BaseDriver<AzureMeta> {
  readonly name = "azure";
  private container: string;
  private auth: ResolvedAuth;
  private endpoint: string;
  private baseUrl: string;
  private blockSize: number;
  private maxSizeBytes: number | undefined;

  constructor(config: AzureDriverConfig) {
    const fromString = config.connectionString ? parseConnectionString(config.connectionString) : {};
    const accountName = config.accountName ?? fromString.accountName;
    const accountKey = config.accountKey ?? fromString.accountKey;
    const sasToken = config.sasToken ?? fromString.sasToken;
    const endpoint = config.endpoint ?? fromString.endpoint;

    if (!config.container) {
      throw new StorageError("config", "AzureDriver requires a container", { provider: PROVIDER });
    }
    const name = accountName ?? (endpoint ? accountFromEndpoint(endpoint) : undefined);
    if (!name) {
      throw new StorageError("config", "AzureDriver requires accountName (or a connection string or endpoint)", { provider: PROVIDER });
    }
    if (!accountKey && !sasToken) {
      throw new StorageError("config", "AzureDriver requires accountKey, sasToken or a connection string with credentials", { provider: PROVIDER });
    }

    this.container = config.container;
    this.auth = {
      accountName: name,
      ...(accountKey ? { accountKey } : {}),
      ...(sasToken ? { sasToken: sasToken.replace(/^\?/, "") } : {}),
    };
    this.endpoint = (endpoint ?? `https://${name}.blob.core.windows.net`).replace(/\/+$/, "");
    this.baseUrl = (config.baseUrl ?? `${this.endpoint}/${config.container}`).replace(/\/+$/, "");
    this.blockSize = Math.min(Math.max(config.blockSize ?? DEFAULT_BLOCK_SIZE, MIN_BLOCK_SIZE), MAX_BLOCK_SIZE);
    this.maxSizeBytes = config.maxSizeBytes;
  }

  async upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
    context?: UploadContext,
  ): Promise<UploadResult<AzureMeta>> {
    validateUploadOptions(options);
    for (const key of Object.keys(options.metadata ?? {})) {
      if (!METADATA_NAME.test(key)) {
        throw new ValidationError(
          `Azure metadata keys must be letters, digits and underscores, not starting with a digit (got "${key}")`,
        );
      }
    }
    if (this.maxSizeBytes !== undefined && options.size !== undefined && options.size > this.maxSizeBytes) {
      throw new StorageError("size-exceeded", `file size ${options.size} exceeds maxSizeBytes ${this.maxSizeBytes}`, { provider: PROVIDER });
    }

    const id = options.id ?? randomUUID();
    const path = this.pathFor({ ...options, id });
    const contentType = options.mimeType ?? "application/octet-stream";
    const metaHeaders: Record<string, string> = {
      ...Object.fromEntries(Object.entries(options.metadata ?? {}).map(([k, v]) => [`x-ms-meta-${k}`, v])),
      ...(context?.uploadToken ? { [TOKEN_HEADER]: context.uploadToken } : {}),
    };
    const signal = options.signal;

    // Read one block at a time, so peak memory is bounded by `blockSize`.
    const reader = stream.getReader();
    let aborted = signal?.aborted ?? false;
    const onAbort = () => {
      aborted = true;
      // Cancelling the reader wakes any pending `read()` with `done: true`.
      reader.cancel().catch(() => {});
    };
    if (signal && !aborted) signal.addEventListener("abort", onAbort, { once: true });
    // Uncommitted blocks are discarded by the service after 7 days, and never
    // touch an existing committed blob, so an abort needs no server cleanup.
    const ensureNotAborted = () => {
      if (aborted) throw abortError("upload aborted");
    };

    let buffer: Uint8Array[] = [];
    let bufferedLen = 0;
    let totalBytes = 0;
    const blockIds: string[] = [];

    const putBlock = async (bytes: Uint8Array) => {
      if (blockIds.length >= MAX_BLOCKS) {
        throw new StorageError("size-exceeded", `upload exceeds ${MAX_BLOCKS} blocks; raise blockSize`, { provider: PROVIDER });
      }
      const blockId = bytesToBase64(new TextEncoder().encode(`fileway-${String(blockIds.length).padStart(6, "0")}`));
      const res = await this.request("PUT", path, {
        query: { comp: "block", blockid: blockId },
        body: bytes,
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) throw await azureError(`Azure put block ${blockIds.length + 1} failed`, res);
      blockIds.push(blockId);
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        ensureNotAborted();
        if (done) break;
        totalBytes += value.byteLength;
        if (this.maxSizeBytes !== undefined && totalBytes > this.maxSizeBytes) {
          await reader.cancel().catch(() => {});
          throw new StorageError("size-exceeded", `upload exceeds maxSizeBytes ${this.maxSizeBytes}`, { provider: PROVIDER });
        }
        buffer.push(value);
        bufferedLen += value.byteLength;

        while (bufferedLen >= this.blockSize) {
          const merged = concatBytes(buffer, bufferedLen);
          await putBlock(merged.subarray(0, this.blockSize));
          const rest = merged.subarray(this.blockSize);
          buffer = rest.byteLength > 0 ? [rest] : [];
          bufferedLen = rest.byteLength;
        }
      }

      if (options.size !== undefined && totalBytes !== options.size) {
        throw new ValidationError(`stream delivered ${totalBytes} bytes, expected ${options.size}`);
      }

      let res: Response;
      if (blockIds.length === 0) {
        // Small file: one Put Blob carries content, type and metadata.
        res = await this.request("PUT", path, {
          headers: { "x-ms-blob-type": "BlockBlob", "content-type": contentType, ...metaHeaders },
          body: concatBytes(buffer, bufferedLen),
          ...(signal ? { signal } : {}),
        });
        if (!res.ok) throw await azureError("Azure upload failed", res);
      } else {
        if (bufferedLen > 0) await putBlock(concatBytes(buffer, bufferedLen));
        ensureNotAborted();
        const xml = `<?xml version="1.0" encoding="utf-8"?><BlockList>${blockIds
          .map((b) => `<Latest>${b}</Latest>`)
          .join("")}</BlockList>`;
        res = await this.request("PUT", path, {
          query: { comp: "blocklist" },
          headers: { "content-type": "application/xml", "x-ms-blob-content-type": contentType, ...metaHeaders },
          body: new TextEncoder().encode(xml),
          ...(signal ? { signal } : {}),
        });
        if (!res.ok) throw await azureError("Azure put block list failed", res);
      }

      const etag = res.headers.get("etag") ?? undefined;
      return {
        id,
        url: `${this.baseUrl}/${urlEncodePath(path)}`,
        path,
        size: totalBytes,
        meta: { container: this.container, ...(etag ? { etag } : {}) },
      };
    } catch (err) {
      reader.cancel().catch(() => {});
      throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** Deletes the blob; a missing blob is not an error. */
  async delete(path: string, options?: OperationOptions): Promise<void> {
    const res = await this.request("DELETE", path, withSignal(options));
    if (res.status === 404 && errorCode(res) !== "ContainerNotFound") return;
    if (!res.ok) throw await azureError("Azure delete failed", res);
  }

  async getUrl(path: string, _options?: OperationOptions): Promise<string> {
    return `${this.baseUrl}/${urlEncodePath(path)}`;
  }

  /** Streams the blob. `options.signal` also cancels reading the body. */
  /** Range reads, and the upload size limit used by upload links. */
  get capabilities(): DriverCapabilities {
    return { range: true, ...(this.maxSizeBytes !== undefined ? { maxUploadBytes: this.maxSizeBytes } : {}) };
  }

  async get(path: string, options?: GetOptions): Promise<ReadableStream<Uint8Array>> {
    const res = await this.request("GET", path, { headers: (options?.range ? { range: `bytes=${options.range.start}-${options.range.end ?? ""}` } : {}), ...withSignal(options) });
    if (!res.ok) throw await azureError("Azure get failed", res);
    if (!res.body) {
      throw new StorageError("provider-error", "Azure get returned no response body", { provider: PROVIDER });
    }
    return res.body;
  }

  /**
   * A read-only service SAS URL for `path`, valid for `expiresIn` seconds
   * (integer in 1..604800, default 3600). Needs an account key.
   */
  async getPresignedUrl(path: string, options?: PresignedUrlOptions): Promise<string> {
    const expiresIn = options?.expiresIn ?? PRESIGN_DEFAULT_EXPIRY;
    if (!Number.isInteger(expiresIn) || expiresIn < PRESIGN_MIN_EXPIRY || expiresIn > PRESIGN_MAX_EXPIRY) {
      throw new ValidationError(
        `expiresIn must be an integer between ${PRESIGN_MIN_EXPIRY} and ${PRESIGN_MAX_EXPIRY} seconds`,
      );
    }
    const { accountName, accountKey } = this.auth;
    if (!accountKey) {
      throw new StorageError("config", "AzureDriver needs accountKey to create presigned URLs", { provider: PROVIDER });
    }
    const sas = await blobReadSas(accountName, accountKey, this.container, path, new Date(Date.now() + expiresIn * 1000));
    return `${this.blobUrl(path)}?${sas}`;
  }

  /** The blob name an upload with `options.id` is stored under: `<path>/<id>.<ext>`. */
  pathFor(options: UploadOptions & { id: string }): string {
    const ext = options.filename.includes(".") ? options.filename.split(".").pop()! : "";
    const filename = ext ? `${options.id}.${ext}` : options.id;
    return options.path ? `${options.path}/${filename}` : filename;
  }

  /** The blob at `path` (a `HEAD` request), or `null` if it does not exist. */
  async head(path: string, options?: OperationOptions): Promise<StoredObject<AzureMeta> | null> {
    const res = await this.request("HEAD", path, withSignal(options));
    if (res.status === 404 && errorCode(res) !== "ContainerNotFound") return null;
    if (!res.ok) throw await azureError("Azure head failed", res);

    const etag = res.headers.get("etag") ?? undefined;
    const token = res.headers.get(TOKEN_HEADER) ?? undefined;
    const modified = res.headers.get("last-modified");
    const contentType = res.headers.get("content-type") ?? undefined;
    const name = path.split("/").pop() ?? path;
    return {
      id: name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name,
      url: `${this.baseUrl}/${urlEncodePath(path)}`,
      path,
      size: Number(res.headers.get("content-length") ?? 0),
      meta: { container: this.container, ...(etag ? { etag } : {}) },
      ...(token ? { uploadToken: token } : {}),
      ...(modified ? { lastModified: new Date(modified) } : {}),
      ...(contentType ? { contentType } : {}),
    };
  }

  /** Whether blocks have been staged for `path` but not yet committed. */
  async isPending(path: string, options?: OperationOptions): Promise<boolean> {
    const res = await this.request("GET", path, {
      query: { comp: "blocklist", blocklisttype: "uncommitted" },
      ...withSignal(options),
    });
    if (res.status === 404 && errorCode(res) !== "ContainerNotFound") return false;
    const body = await res.text().catch(() => "");
    if (!res.ok) throw azureErrorFrom("Azure get block list failed", res, body);
    const uncommitted = body.match(/<UncommittedBlocks>(.*?)<\/UncommittedBlocks>/s)?.[1] ?? "";
    return uncommitted.includes("<Block>");
  }

  /** One page of the blobs under `options.prefix` (List Blobs). */
  async list(options?: ListOptions): Promise<ListPage> {
    const res = await this.request("GET", "", {
      query: {
        restype: "container",
        comp: "list",
        prefix: options?.prefix ?? "",
        maxresults: String(options?.limit ?? 100),
        ...(options?.recursive ? {} : { delimiter: "/" }),
        ...(options?.cursor !== undefined ? { marker: decodeCursor<string>(options.cursor) } : {}),
      },
      ...withSignal(options),
    });
    const body = await res.text().catch(() => "");
    if (!res.ok) throw azureErrorFrom("Azure list failed", res, body);

    const objects: ListedObject[] = xmlBlocks(body, "Blob").map((blob) => {
      const modified = xmlValue(blob, "Last-Modified");
      const etag = xmlValue(blob, "Etag");
      const type = xmlValue(blob, "Content-Type");
      return {
        path: unescapeXml(xmlValue(blob, "Name") ?? ""),
        size: Number(xmlValue(blob, "Content-Length") ?? 0),
        ...(modified ? { lastModified: new Date(modified) } : {}),
        ...(etag ? { etag } : {}),
        ...(type ? { contentType: unescapeXml(type) } : {}),
      };
    });
    const folders = xmlBlocks(body, "BlobPrefix").map((p) => unescapeXml(xmlValue(p, "Name") ?? ""));
    const next = xmlValue(body, "NextMarker");
    return { objects, folders, ...(next ? { cursor: encodeCursor(next) } : {}) };
  }

  /**
   * Copies a blob in this container (Copy Blob), waiting for it to finish when
   * the service copies in the background. With `overwrite: false` the copy is
   * made only if `to` does not exist (`If-None-Match: *`), atomically.
   */
  async copy(from: string, to: string, options?: CopyOptions): Promise<void> {
    const source = new URL(this.blobUrl(from));
    if (this.auth.sasToken && !this.auth.accountKey) {
      for (const [k, v] of new URLSearchParams(this.auth.sasToken)) source.searchParams.set(k, v);
    }
    const res = await this.request("PUT", to, {
      headers: { "x-ms-copy-source": source.href, ...(options?.overwrite ? {} : { "if-none-match": "*" }) },
      ...withSignal(options),
    });
    if (!res.ok) throw await azureError("Azure copy failed", res);

    let status = res.headers.get("x-ms-copy-status");
    for (let wait = 200; status === "pending"; wait = Math.min(wait * 2, 2000)) {
      await delay(wait, options?.signal);
      const head = await this.request("HEAD", to, withSignal(options));
      if (!head.ok) throw await azureError("Azure copy status check failed", head);
      status = head.headers.get("x-ms-copy-status");
      if (status === "failed" || status === "aborted") {
        throw new StorageError(
          "provider-error",
          `Azure copy ${status}: ${head.headers.get("x-ms-copy-status-description") ?? "no details"}`,
          { provider: PROVIDER },
        );
      }
    }
  }

  /** Copies, then deletes the source. Blob Storage has no rename. */
  async move(from: string, to: string, options?: CopyOptions): Promise<void> {
    await this.copy(from, to, options);
    await this.delete(from, options);
  }

  private blobUrl(path: string): string {
    return `${this.endpoint}/${this.container}/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  /** A signed (Shared Key) or SAS-authorized request to one blob. */
  private async request(
    method: string,
    path: string,
    init: {
      query?: Record<string, string>;
      headers?: Record<string, string>;
      body?: Uint8Array;
      signal?: AbortSignal;
    } = {},
  ): Promise<Response> {
    // An empty path addresses the container itself (e.g. List Blobs).
    const url = new URL(path === "" ? `${this.endpoint}/${this.container}` : this.blobUrl(path));
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

    let headers: Record<string, string>;
    const { accountName, accountKey, sasToken } = this.auth;
    if (accountKey) {
      headers = await signRequest(method, url, accountName, accountKey, init.headers ?? {}, init.body?.byteLength);
    } else {
      for (const [k, v] of new URLSearchParams(sasToken)) url.searchParams.set(k, v);
      headers = {
        ...init.headers,
        "x-ms-date": new Date().toUTCString(),
        "x-ms-version": SERVICE_VERSION,
      };
    }

    return fetchWithAbort(url, {
      method,
      headers,
      ...(init.body ? { body: init.body as BodyInit } : {}),
      signal: init.signal ?? null,
    });
  }
}

/** The inner XML of every `<tag>...</tag>` block. */
function xmlBlocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, "gs"))].map((m) => m[1] ?? "");
}

function xmlValue(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, "s"))?.[1] || undefined;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** Waits `ms`, or rejects with an `AbortError` when `signal` aborts first. */
function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError("copy aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError("copy aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function withSignal(options: OperationOptions | undefined): { signal?: AbortSignal } {
  return options?.signal ? { signal: options.signal } : {};
}

/** The account name from a `<account>.blob.<suffix>` host or an Azurite-style
 * `http://host:port/<account>` endpoint. */
function accountFromEndpoint(endpoint: string): string | undefined {
  const url = new URL(endpoint);
  const fromHost = url.hostname.match(/^([a-z0-9]+)\.blob\./)?.[1];
  return fromHost ?? (url.pathname.split("/").filter(Boolean)[0] || undefined);
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

/** The service error code: the `x-ms-error-code` header, which Azure sends on
 * every failure (including bodiless HEAD responses), or the XML `<Code>`. */
function errorCode(res: Response, body?: string): string | undefined {
  return res.headers.get("x-ms-error-code") ?? body?.match(/<Code>(.*?)<\/Code>/s)?.[1];
}

function azureErrorFrom(prefix: string, res: Response, body: string): StorageError {
  const code = errorCode(res, body);
  return new StorageError(
    classifyAzureError(res.status, code),
    `${prefix}: ${res.status} ${res.statusText}${code ? ` (${code})` : ""}`,
    { statusCode: res.status, provider: PROVIDER },
  );
}

async function azureError(prefix: string, res: Response): Promise<StorageError> {
  const body = await res.text().catch(() => "");
  return azureErrorFrom(prefix, res, body);
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
