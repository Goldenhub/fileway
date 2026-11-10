import type { BaseDriver, CopyOptions, ListedObject, ListOptions, ListPage, OperationOptions, PresignedUrlOptions, StorageErrorCode, StoredObject, UploadContext, UploadOptions, UploadResult } from "@fileway/core";
import { validateUploadOptions, ValidationError, urlEncodePath, abortError, isAbortError, StorageError, encodeCursor, decodeCursor } from "@fileway/core";
import { buildCanonicalQueryString, createStreamingBody, presignUrl, sign, signStreamingRequest, sha256 } from "./sigv4.js";
import type { SigV4Credentials } from "./sigv4.js";

const randomUUID = () => globalThis.crypto.randomUUID();
const SERVICE = "s3";
const SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

// A single PUT is capped at 5 GiB; larger objects must go through multipart.
const SINGLE_PUT_MAX = 5 * 1024 ** 3;
const DEFAULT_PART_SIZE = 8 * 1024 * 1024;
const MIN_PART_SIZE = 5 * 1024 * 1024;
const PRESIGN_DEFAULT_EXPIRY = 3600;
// Part size for multipart copies of objects over 5 GiB.
const MULTIPART_COPY_PART = 512 * 1024 * 1024;
// AWS caps presigned URLs at 7 days.
const PRESIGN_MIN_EXPIRY = 1;
const PRESIGN_MAX_EXPIRY = 604800;
// Object metadata header carrying FilewayClient's per-upload token.
const TOKEN_HEADER = "x-amz-meta-fileway-upload-token";

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Session token for temporary credentials (STS, Lambda/ECS roles, SSO). */
  sessionToken?: string;
}

export interface S3DriverConfig {
  bucket: string;
  region?: string;
  credentials?: S3Credentials;
  baseUrl?: string;
  endpoint?: string;
  /** Address the bucket in the URL path (`<host>/<bucket>/<key>`) instead of
   * the hostname (`<bucket>.<host>/<key>`). Defaults to `true` with a custom
   * `endpoint` (MinIO, R2) and `false` for AWS. */
  forcePathStyle?: boolean;
  /** Multipart part size in bytes. Default 8 MiB, clamped to a 5 MiB minimum. */
  partSize?: number;
  /** Force multipart for every upload, regardless of size. Defaults to `true`
   * for a Google Cloud Storage endpoint (`storage.googleapis.com`). */
  forceMultipart?: boolean;
  /** Reject uploads larger than this many bytes with a `size-exceeded` error. */
  maxSizeBytes?: number;
}

export type S3Meta = {
  bucket: string;
  etag?: string;
};

function isGcsEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return false;
  try {
    return new URL(endpoint).hostname === "storage.googleapis.com";
  } catch {
    return false;
  }
}

export class S3Driver implements BaseDriver<S3Meta> {
  readonly name = "s3";
  private config: Required<Pick<S3DriverConfig, "region">> & S3DriverConfig;
  private baseUrl: string;
  private partSize: number;
  private forceMultipart: boolean;

  constructor(config: S3DriverConfig) {
    this.config = { region: "us-east-1", ...config };
    this.baseUrl = config.baseUrl ?? resolveBaseUrl(this.config);
    this.partSize = Math.max(config.partSize ?? DEFAULT_PART_SIZE, MIN_PART_SIZE);
    // GCS's S3 interop stores aws-chunked signatures inside the object, so a
    // streamed single PUT would corrupt it; multipart sends plain bodies.
    this.forceMultipart = config.forceMultipart ?? isGcsEndpoint(config.endpoint);
  }

  async upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
    context?: UploadContext,
  ): Promise<UploadResult<S3Meta>> {
    validateUploadOptions(options);
    const maxSize = this.config.maxSizeBytes;
    if (maxSize !== undefined && options.size !== undefined && options.size > maxSize) {
      throw new StorageError("size-exceeded", `file size ${options.size} exceeds maxSizeBytes ${maxSize}`, { provider: "s3" });
    }

    const id = options.id ?? randomUUID();
    const key = this.pathFor({ ...options, id });

    const cred = getCredentials(this.config);

    const metaHeaders: Record<string, string> = {
      ...(options.metadata
        ? Object.fromEntries(
            Object.entries(options.metadata).map(([k, v]) => [
              `x-amz-meta-${k.toLowerCase()}`,
              v,
            ]),
          )
        : {}),
      ...(context?.uploadToken ? { [TOKEN_HEADER]: context.uploadToken } : {}),
    };

    const typeHeader = options.mimeType ?? "application/octet-stream";

    // Multipart: unknown size (memory-safe without buffering the whole file),
    // sizes beyond the 5 GiB single-PUT cap, or when explicitly requested.
    const useMultipart =
      options.size === undefined || options.size > SINGLE_PUT_MAX || this.forceMultipart;

    if (useMultipart) {
      return this.multipartUpload(stream, {
        id,
        key,
        metaHeaders,
        typeHeader,
        cred,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.size !== undefined ? { expectedSize: options.size } : {}),
      });
    }

    // Streaming path: the caller knows the size, so we can sign and stream the
    // body chunk-by-chunk (aws-chunked) without ever buffering the file.
    // `useMultipart` is false here, which guarantees `options.size` is defined.
    const knownSize = options.size!;
    const now = new Date();
    const { url, canonicalPath, host } = buildEndpoint(this.config, key);

    const { headers: sigHeaders, seedSignature, signingKey, scope, amzDate } = await signStreamingRequest(
      "PUT",
      canonicalPath,
      {
        host,
        "content-type": typeHeader,
        ...metaHeaders,
      },
      knownSize,
      { ...cred, region: this.config.region!, service: SERVICE },
      now,
    );

    const bodyError: { current?: Error } = {};
    let response: Response;
    try {
      response = await fetchWithAbort(url, {
        method: "PUT",
        headers: {
          ...sigHeaders,
          ...metaHeaders,
          "content-type": typeHeader,
        },
        body: createStreamingBody(stream, knownSize, seedSignature, amzDate, scope, signingKey, bodyError),
        // Node's fetch (undici) requires `duplex: "half"` for stream bodies;
        // other runtimes ignore it.
        duplex: "half",
        signal: options.signal ?? null,
      } as RequestInit, "s3");
    } catch (err) {
      // An errored body (e.g. size mismatch) surfaces as a generic `fetch
      // failed`; rethrow the specific ValidationError when present.
      if (bodyError.current) throw bodyError.current;
      throw err;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw s3Error(`S3 upload failed: ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`, response.status, body);
    }

    const etag = response.headers.get("etag") ?? undefined;

    return {
      id,
      url: `${this.baseUrl}/${urlEncodePath(key)}`,
      path: key,
      size: knownSize,
      meta: {
        bucket: this.config.bucket,
        ...(etag ? { etag } : {}),
      },
    };
  }

  private async multipartUpload(
    stream: ReadableStream<Uint8Array>,
    args: {
      id: string;
      key: string;
      metaHeaders: Record<string, string>;
      typeHeader: string;
      cred: S3Credentials;
      signal?: AbortSignal;
      expectedSize?: number;
    },
  ): Promise<UploadResult<S3Meta>> {
    const { id, key, metaHeaders, typeHeader, signal, expectedSize } = args;
    const cred = { ...args.cred, region: this.config.region!, service: SERVICE };

    // Every request below is signed with its own timestamp: S3 rejects a
    // signature more than ~15 minutes off the server clock, and a multipart
    // upload can run far longer than that.

    // 1. CreateMultipartUpload: object metadata and content-type live here.
    const create = buildEndpoint(this.config, key, { uploads: "" });
    const createHeaders = await sign(
      "POST",
      create.canonicalPath,
      { host: create.host, "content-type": typeHeader, ...metaHeaders },
      SHA256_EMPTY,
      cred,
      new Date(),
      { uploads: "" },
    );
    const createRes = await fetchWithAbort(create.url, {
      method: "POST",
      headers: { ...createHeaders, ...metaHeaders, "content-type": typeHeader },
      signal: signal ?? null,
    }, "s3");
    if (!createRes.ok) {
      const body = await createRes.text().catch(() => "");
      throw s3Error(`S3 multipart create failed: ${createRes.status} ${createRes.statusText}${body ? `: ${body}` : ""}`, createRes.status, body);
    }
    const uploadId = extractXml(await createRes.text(), "UploadId");
    if (!uploadId) {
      throw new StorageError("provider-error", "S3 multipart create returned no UploadId", { provider: "s3" });
    }

    const abort = () => this.abortMultipart(key, uploadId, cred);

    // 2. UploadPart: stream into one part-sized buffer at a time, so peak
    // memory is bounded by `partSize` regardless of file size.
    const reader = stream.getReader();
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      // Cancelling the reader wakes any pending `read()` with `done: true`,
      // so an abort is noticed even when the producer is mid-stream.
      reader.cancel().catch(() => {});
    };
    if (signal) {
      if (signal.aborted) {
        aborted = true;
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
    const ensureNotAborted = async () => {
      if (aborted) {
        await abort();
        throw abortError("upload aborted");
      }
    };

    let buffer: Uint8Array[] = [];
    let bufferedLen = 0;
    let totalBytes = 0;
    let partNumber = 1;
    const parts: { partNumber: number; etag: string }[] = [];

    const uploadPart = async (bytes: Uint8Array) => {
      const part = buildEndpoint(this.config, key, { partNumber: String(partNumber), uploadId });
      const partSig = await sign(
        "PUT",
        part.canonicalPath,
        { host: part.host },
        await sha256(bytes),
        cred,
        new Date(),
        { partNumber: String(partNumber), uploadId },
      );
      let res: Response;
      try {
        res = await fetchWithAbort(part.url, {
          method: "PUT",
          headers: { ...partSig, "content-length": String(bytes.byteLength) },
          body: bytes as BodyInit,
          signal: signal ?? null,
        }, "s3");
      } catch (err) {
        // Includes abort: undo the server-side multipart session, then rethrow
        // the original error (an AbortError when the user cancelled).
        await abort();
        throw err;
      }
      if (!res.ok) {
        await abort();
        throw s3Error(`S3 multipart part ${partNumber} failed: ${res.status} ${res.statusText}`, res.status);
      }
      const etag = res.headers.get("etag");
      if (!etag) {
        // Without the part's ETag the upload cannot be completed. In browsers
        // this usually means the bucket's CORS rules do not expose `ETag`.
        await abort();
        throw new StorageError(
          "provider-error",
          `S3 multipart part ${partNumber} returned no ETag header (if uploading from a browser, add "ETag" to the bucket's CORS ExposeHeaders)`,
          { provider: "s3" },
        );
      }
      parts.push({ partNumber: partNumber++, etag });
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        await ensureNotAborted();
        if (done) break;
        totalBytes += value.byteLength;
        if (this.config.maxSizeBytes !== undefined && totalBytes > this.config.maxSizeBytes) {
          await abort();
          throw new StorageError("size-exceeded", `upload exceeds maxSizeBytes ${this.config.maxSizeBytes}`, { provider: "s3" });
        }
        buffer.push(value);
        bufferedLen += value.byteLength;

        if (bufferedLen >= this.partSize) {
          const merged = concatBytes(buffer, bufferedLen);
          await uploadPart(merged.subarray(0, this.partSize));
          const rest = merged.subarray(this.partSize);
          buffer = rest.byteLength > 0 ? [rest] : [];
          bufferedLen = rest.byteLength;
        }
      }

      if (expectedSize !== undefined && totalBytes !== expectedSize) {
        await abort();
        throw new ValidationError(`stream delivered ${totalBytes} bytes, expected ${expectedSize}`);
      }

      if (parts.length === 0 && bufferedLen === 0) {
        // An empty stream can't be represented as a zero-part multipart upload;
        // abort it and fall back to a single empty PUT.
        await abort();
        return this.singlePut(id, key, new Uint8Array(0), metaHeaders, typeHeader, args.cred, signal);
      }

      if (bufferedLen > 0) {
        await uploadPart(concatBytes(buffer, bufferedLen));
      }

      // 3. CompleteMultipartUpload.
      await ensureNotAborted();
      const complete = buildEndpoint(this.config, key, { uploadId });
      const xmlBytes = new TextEncoder().encode(buildCompleteXml(parts));
      const completeHeaders = await sign(
        "POST",
        complete.canonicalPath,
        { host: complete.host },
        await sha256(xmlBytes),
        cred,
        new Date(),
        { uploadId },
      );
      const completeRes = await fetchWithAbort(complete.url, {
        method: "POST",
        headers: { ...completeHeaders, "content-type": "application/xml" },
        body: xmlBytes,
        signal: signal ?? null,
      }, "s3");
      if (!completeRes.ok) {
        await abort();
        throw s3Error(`S3 multipart complete failed: ${completeRes.status} ${completeRes.statusText}`, completeRes.status);
      }
      const etag = extractXml(await completeRes.text(), "ETag");

      return {
        id,
        url: `${this.baseUrl}/${urlEncodePath(key)}`,
        path: key,
        size: totalBytes,
        meta: {
          bucket: this.config.bucket,
          ...(etag ? { etag } : {}),
        },
      };
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private async singlePut(
    id: string,
    key: string,
    bytes: Uint8Array,
    metaHeaders: Record<string, string>,
    typeHeader: string,
    baseCred: S3Credentials,
    signal?: AbortSignal,
  ): Promise<UploadResult<S3Meta>> {
    const cred = { ...baseCred, region: this.config.region!, service: SERVICE };
    const now = new Date();
    const { url, canonicalPath, host } = buildEndpoint(this.config, key);
    const payloadHash = await sha256(bytes);
    const sigHeaders = await sign(
      "PUT",
      canonicalPath,
      { host, "content-type": typeHeader, ...metaHeaders },
      payloadHash,
      cred,
      now,
    );

    const response = await fetchWithAbort(url, {
      method: "PUT",
      headers: {
        ...sigHeaders,
        ...metaHeaders,
        "content-type": typeHeader,
        "content-length": String(bytes.byteLength),
      },
      body: bytes as BodyInit,
      signal: signal ?? null,
    }, "s3");
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw s3Error(`S3 upload failed: ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`, response.status, body);
    }

    const etag = response.headers.get("etag") ?? undefined;
    return {
      id,
      url: `${this.baseUrl}/${urlEncodePath(key)}`,
      path: key,
      size: bytes.byteLength,
      meta: {
        bucket: this.config.bucket,
        ...(etag ? { etag } : {}),
      },
    };
  }

  private async abortMultipart(
    key: string,
    uploadId: string,
    cred: SigV4Credentials,
  ): Promise<void> {
    try {
      const abort = buildEndpoint(this.config, key, { uploadId });
      const headers = await sign("DELETE", abort.canonicalPath, { host: abort.host }, SHA256_EMPTY, cred, new Date());
      await fetch(abort.url, { method: "DELETE", headers });
    } catch {
      // Best-effort cleanup; the original error is the important one.
    }
  }

  /** Deletes the object. S3 answers success whether or not it existed. */
  async delete(path: string, options?: OperationOptions): Promise<void> {
    const cred = getCredentials(this.config);
    const { url, canonicalPath, host } = buildEndpoint(this.config, path);
    const now = new Date();

    const sigHeaders = await sign(
      "DELETE",
      canonicalPath,
      { "host": host },
      SHA256_EMPTY,
      { ...cred, region: this.config.region!, service: SERVICE },
      now,
    );

    const response = await fetchWithAbort(url, { method: "DELETE", headers: sigHeaders, signal: options?.signal ?? null }, "s3");
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = s3Error(`S3 delete failed: ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`, response.status, body);
      // Some S3-compatible services answer 404 for a missing key.
      if (error.code === "not-found") return;
      throw error;
    }
  }

  /** The object key an upload with `options.id` is stored under: `<path>/<id>.<ext>`. */
  pathFor(options: UploadOptions & { id: string }): string {
    const ext = options.filename.includes(".") ? options.filename.split(".").pop()! : "";
    const filename = ext ? `${options.id}.${ext}` : options.id;
    return options.path ? `${options.path}/${filename}` : filename;
  }

  /** The object at `path` (a signed `HEAD`), or `null` if it does not exist. */
  async head(path: string, options?: OperationOptions): Promise<StoredObject<S3Meta> | null> {
    const cred = getCredentials(this.config);
    const { url, canonicalPath, host } = buildEndpoint(this.config, path);
    const headers = await sign(
      "HEAD",
      canonicalPath,
      { host },
      SHA256_EMPTY,
      { ...cred, region: this.config.region!, service: SERVICE },
      new Date(),
    );
    const response = await fetchWithAbort(url, { method: "HEAD", headers, signal: options?.signal ?? null }, "s3");
    if (response.status === 404) return null;
    if (!response.ok) {
      throw s3Error(`S3 head failed: ${response.status} ${response.statusText}`, response.status);
    }

    const etag = response.headers.get("etag") ?? undefined;
    const token = response.headers.get(TOKEN_HEADER) ?? undefined;
    const modified = response.headers.get("last-modified");
    const contentType = response.headers.get("content-type") ?? undefined;
    const name = path.split("/").pop() ?? path;
    return {
      id: name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name,
      url: `${this.baseUrl}/${urlEncodePath(path)}`,
      path,
      size: Number(response.headers.get("content-length") ?? 0),
      meta: { bucket: this.config.bucket, ...(etag ? { etag } : {}) },
      ...(token ? { uploadToken: token } : {}),
      ...(modified ? { lastModified: new Date(modified) } : {}),
      ...(contentType ? { contentType } : {}),
    };
  }

  /** Whether a multipart upload to exactly `path` has been started and not completed or aborted. */
  async isPending(path: string, options?: OperationOptions): Promise<boolean> {
    const cred = getCredentials(this.config);
    const query = { prefix: path, uploads: "" };
    const { url, canonicalPath, host } = buildEndpoint(this.config, "", query);
    const headers = await sign(
      "GET",
      canonicalPath,
      { host },
      SHA256_EMPTY,
      { ...cred, region: this.config.region!, service: SERVICE },
      new Date(),
      query,
    );
    const response = await fetchWithAbort(url, { method: "GET", headers, signal: options?.signal ?? null }, "s3");
    const body = await response.text().catch(() => "");
    if (!response.ok) {
      throw s3Error(`S3 list multipart uploads failed: ${response.status} ${response.statusText}`, response.status, body);
    }
    // The prefix also matches longer keys, so require an exact <Key> match.
    const wanted = escapeXml(path);
    return [...body.matchAll(/<Key>(.*?)<\/Key>/gs)].some((m) => m[1] === wanted);
  }

  async getUrl(path: string, _options?: OperationOptions): Promise<string> {
    return `${this.baseUrl}/${urlEncodePath(path)}`;
  }

  /**
   * Returns a time-limited SigV4-presigned GET URL for `path`, so a file can
   * be downloaded by anyone with the link (and no credentials) until `expiresIn`
   * seconds pass. `expiresIn` must be an integer in 1..604800 (AWS's 7-day cap);
   * defaults to 3600.
   */
  async getPresignedUrl(path: string, options?: PresignedUrlOptions): Promise<string> {
    const expiresIn = options?.expiresIn ?? PRESIGN_DEFAULT_EXPIRY;
    if (!Number.isInteger(expiresIn) || expiresIn < PRESIGN_MIN_EXPIRY || expiresIn > PRESIGN_MAX_EXPIRY) {
      throw new ValidationError(
        `expiresIn must be an integer between ${PRESIGN_MIN_EXPIRY} and ${PRESIGN_MAX_EXPIRY} seconds`,
      );
    }

    const cred = getCredentials(this.config);
    const { url, canonicalPath, host } = buildEndpoint(this.config, path);
    const { queryString } = await presignUrl(
      canonicalPath,
      host,
      { ...cred, region: this.config.region!, service: SERVICE },
      new Date(),
      expiresIn,
    );

    return `${url}?${queryString}`;
  }

  /** Streams the object. `options.signal` also cancels reading the body. */
  async get(path: string, options?: OperationOptions): Promise<ReadableStream<Uint8Array>> {
    const cred = getCredentials(this.config);
    const { url, canonicalPath, host } = buildEndpoint(this.config, path);
    const now = new Date();

    const sigHeaders = await sign(
      "GET",
      canonicalPath,
      { "host": host },
      SHA256_EMPTY,
      { ...cred, region: this.config.region!, service: SERVICE },
      now,
    );

    const response = await fetchWithAbort(url, { method: "GET", headers: sigHeaders, signal: options?.signal ?? null }, "s3");
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw s3Error(`S3 get failed: ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`, response.status, body);
    }

    if (!response.body) {
      throw new StorageError("provider-error", "S3 get returned no response body", { provider: "s3" });
    }

    return response.body;
  }

  /** One page of the objects under `options.prefix` (`ListObjectsV2`). */
  async list(options?: ListOptions): Promise<ListPage> {
    const query: Record<string, string> = {
      "list-type": "2",
      prefix: options?.prefix ?? "",
      "max-keys": String(options?.limit ?? 100),
      ...(options?.recursive ? {} : { delimiter: "/" }),
      ...(options?.cursor !== undefined ? { "continuation-token": decodeCursor<string>(options.cursor) } : {}),
    };
    const res = await this.request("GET", "", { query, ...(options?.signal ? { signal: options.signal } : {}) });
    const body = await res.text().catch(() => "");
    if (!res.ok) throw s3Error(`S3 list failed: ${res.status} ${res.statusText}`, res.status, body);

    const objects: ListedObject[] = blocks(body, "Contents").map((block) => {
      const modified = extractXml(block, "LastModified");
      const etag = extractXml(block, "ETag");
      return {
        path: unescapeXml(extractXml(block, "Key") ?? ""),
        size: Number(extractXml(block, "Size") ?? 0),
        ...(modified ? { lastModified: new Date(modified) } : {}),
        ...(etag ? { etag: unescapeXml(etag) } : {}),
      };
    });
    const folders = blocks(body, "CommonPrefixes").map((block) => unescapeXml(extractXml(block, "Prefix") ?? ""));
    const next = extractXml(body, "IsTruncated") === "true" ? extractXml(body, "NextContinuationToken") : undefined;
    return { objects, folders, ...(next ? { cursor: encodeCursor(unescapeXml(next)) } : {}) };
  }

  /**
   * Copies an object in this bucket. Up to 5 GiB it is one `CopyObject`;
   * larger objects are copied in parts (`UploadPartCopy`), which keeps the
   * content type but not custom metadata. With `overwrite: false` the
   * destination is checked first, which is not atomic.
   */
  async copy(from: string, to: string, options?: CopyOptions): Promise<void> {
    const signal = options?.signal;
    const source = await this.head(from, signal ? { signal } : undefined);
    if (!source) throw new StorageError("not-found", `S3 copy failed: ${from} does not exist`, { provider: "s3", statusCode: 404 });
    if (!options?.overwrite && (await this.head(to, signal ? { signal } : undefined))) {
      throw new StorageError("conflict", `S3 copy failed: ${to} already exists`, { provider: "s3" });
    }
    const copySource = `/${this.config.bucket}/${from.split("/").map(encodeURIComponent).join("/")}`;

    if (source.size <= SINGLE_PUT_MAX) {
      const res = await this.request("PUT", to, {
        headers: { "x-amz-copy-source": copySource },
        ...(signal ? { signal } : {}),
      });
      const body = await res.text().catch(() => "");
      // CopyObject can fail after answering 200, with an <Error> body.
      if (!res.ok || body.includes("<Error>")) {
        throw s3Error(`S3 copy failed: ${res.status} ${res.statusText}`, res.ok ? 500 : res.status, body);
      }
      return;
    }
    await this.multipartCopy(copySource, to, source.size, source.contentType, signal);
  }

  /** Copies, then deletes the source. S3 has no rename. */
  async move(from: string, to: string, options?: CopyOptions): Promise<void> {
    await this.copy(from, to, options);
    await this.delete(from, options?.signal ? { signal: options.signal } : undefined);
  }

  private async multipartCopy(
    copySource: string,
    to: string,
    size: number,
    contentType: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const cred = { ...getCredentials(this.config), region: this.config.region!, service: SERVICE };
    const create = await this.request("POST", to, {
      query: { uploads: "" },
      headers: { "content-type": contentType ?? "application/octet-stream" },
      ...(signal ? { signal } : {}),
    });
    const createBody = await create.text().catch(() => "");
    if (!create.ok) throw s3Error(`S3 multipart copy create failed: ${create.status}`, create.status, createBody);
    const uploadId = extractXml(createBody, "UploadId");
    if (!uploadId) throw new StorageError("provider-error", "S3 multipart copy returned no UploadId", { provider: "s3" });

    // At most 10,000 parts, each at most 5 GiB.
    const partSize = Math.max(MULTIPART_COPY_PART, Math.ceil(size / 10_000));
    const parts: { partNumber: number; etag: string }[] = [];
    try {
      for (let start = 0, partNumber = 1; start < size; start += partSize, partNumber++) {
        const end = Math.min(start + partSize, size) - 1;
        const res = await this.request("PUT", to, {
          query: { partNumber: String(partNumber), uploadId },
          headers: { "x-amz-copy-source": copySource, "x-amz-copy-source-range": `bytes=${start}-${end}` },
          ...(signal ? { signal } : {}),
        });
        const body = await res.text().catch(() => "");
        const etag = extractXml(body, "ETag");
        if (!res.ok || !etag) throw s3Error(`S3 copy part ${partNumber} failed: ${res.status}`, res.ok ? 500 : res.status, body);
        parts.push({ partNumber, etag: unescapeXml(etag) });
      }
      const complete = await this.request("POST", to, {
        query: { uploadId },
        headers: { "content-type": "application/xml" },
        body: new TextEncoder().encode(buildCompleteXml(parts)),
        ...(signal ? { signal } : {}),
      });
      const body = await complete.text().catch(() => "");
      if (!complete.ok || body.includes("<Error>")) {
        throw s3Error(`S3 multipart copy complete failed: ${complete.status}`, complete.ok ? 500 : complete.status, body);
      }
    } catch (err) {
      await this.abortMultipart(to, uploadId, cred);
      throw err;
    }
  }

  /** A SigV4-signed request for `key` (or the bucket, with key ""). */
  private async request(
    method: string,
    key: string,
    init: { query?: Record<string, string>; headers?: Record<string, string>; body?: Uint8Array; signal?: AbortSignal } = {},
  ): Promise<Response> {
    const cred = getCredentials(this.config);
    const { url, canonicalPath, host } = buildEndpoint(this.config, key, init.query);
    const headers = init.headers ?? {};
    const sigHeaders = await sign(
      method,
      canonicalPath,
      { host, ...headers },
      init.body ? await sha256(init.body) : SHA256_EMPTY,
      { ...cred, region: this.config.region!, service: SERVICE },
      new Date(),
      init.query,
    );
    return fetchWithAbort(url, {
      method,
      headers: { ...sigHeaders, ...headers },
      ...(init.body ? { body: init.body as BodyInit } : {}),
      signal: init.signal ?? null,
    }, "s3");
  }
}

/** The inner XML of every `<tag>...</tag>` block. */
function blocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, "gs"))].map((m) => m[1] ?? "");
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

function getCredentials(config: S3DriverConfig): S3Credentials {
  if (config.credentials) return config.credentials;
  throw new StorageError("config", "S3Driver requires credentials in config", { provider: "s3" });
}

/** `fetch` that converts non-abort failures into a typed `network` error,
 * while letting aborts (`AbortError`) pass through untouched. */
async function fetchWithAbort(url: string | URL, init: RequestInit, provider: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (isAbortError(err)) throw err;
    const cause = err instanceof Error ? err : new Error(String(err));
    throw new StorageError("network", `${provider} network error: ${cause.message}`, { provider, cause });
  }
}

/** Classifies an S3 failure into a typed code using the AWS/MinIO XML error
 * `<Code>` when present, falling back to the HTTP status. */
function classifyS3Error(status: number, body: string): StorageErrorCode {
  switch (extractXml(body, "Code")) {
    case "NoSuchBucket":
      return "bucket-not-found";
    case "NoSuchKey":
    case "NoSuchUpload":
      return "not-found";
    case "AccessDenied":
    case "InvalidAccessKeyId":
    case "SignatureDoesNotMatch":
    case "ExpiredToken":
    case "InvalidToken":
      return "auth-failed";
    case "EntityTooLarge":
      return "size-exceeded";
    case "SlowDown":
    case "TooManyRequests":
    case "RequestLimitExceeded":
      return "rate-limited";
  }
  if (status === 429) return "rate-limited";
  if (status === 401 || status === 403) return "auth-failed";
  if (status === 404) return "not-found";
  if (status === 413) return "size-exceeded";
  return "provider-error";
}

function s3Error(message: string, status: number, body?: string): StorageError {
  return new StorageError(classifyS3Error(status, body ?? ""), message, {
    statusCode: status,
    provider: "s3",
  });
}

/** Resolves where the bucket lives: the origin and host to send requests to,
 * and the path prefix (`/<bucket>` for path-style, empty for virtual-hosted). */
function resolveBucketLocation(config: S3DriverConfig): { origin: string; host: string; prefix: string } {
  const base = config.endpoint
    ? new URL(config.endpoint.replace(/\/+$/, ""))
    : new URL(`https://s3.${config.region ?? "us-east-1"}.amazonaws.com`);
  const pathStyle = config.forcePathStyle ?? config.endpoint !== undefined;
  // Keep any path on a custom endpoint (e.g. a reverse-proxy mount point).
  const basePath = base.pathname.replace(/\/+$/, "");

  if (pathStyle) {
    return { origin: base.origin, host: base.host, prefix: `${basePath}/${config.bucket}` };
  }
  const host = `${config.bucket}.${base.host}`;
  return { origin: `${base.protocol}//${host}`, host, prefix: basePath };
}

function buildEndpoint(
  config: S3DriverConfig,
  key: string,
  query?: Record<string, string>,
): { url: string; canonicalPath: string; host: string } {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const qs = query ? buildCanonicalQueryString(query) : "";
  const suffix = qs ? `?${qs}` : "";
  const { origin, host, prefix } = resolveBucketLocation(config);
  const canonicalPath = `${prefix}/${encodedKey}`;

  return { url: `${origin}${canonicalPath}${suffix}`, canonicalPath, host };
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

function extractXml(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, "s"));
  return match?.[1];
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildCompleteXml(parts: { partNumber: number; etag: string }[]): string {
  const body = parts
    .map(
      (p) =>
        `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`,
    )
    .join("");
  return `<CompleteMultipartUpload>${body}</CompleteMultipartUpload>`;
}

function resolveBaseUrl(config: S3DriverConfig): string {
  const { origin, prefix } = resolveBucketLocation(config);
  return `${origin}${prefix}`;
}
