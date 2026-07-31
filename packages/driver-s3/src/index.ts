import type { BaseDriver, PresignedUrlOptions, UploadOptions, UploadResult } from "@fileway/core";
import { validateUploadOptions, ValidationError, urlEncodePath, abortError } from "@fileway/core";
import { buildCanonicalQueryString, createStreamingBody, presignUrl, sign, signStreamingRequest, sha256 } from "./sigv4.js";

const randomUUID = () => globalThis.crypto.randomUUID();
const SERVICE = "s3";
const SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

// A single PUT is capped at 5 GiB; larger objects must go through multipart.
const SINGLE_PUT_MAX = 5 * 1024 ** 3;
const DEFAULT_PART_SIZE = 8 * 1024 * 1024;
const MIN_PART_SIZE = 5 * 1024 * 1024;
const PRESIGN_DEFAULT_EXPIRY = 3600;
// AWS caps presigned URLs at 7 days.
const PRESIGN_MIN_EXPIRY = 1;
const PRESIGN_MAX_EXPIRY = 604800;

export interface S3DriverConfig {
  bucket: string;
  region?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  baseUrl?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  /** Multipart part size in bytes. Default 8 MiB, clamped to a 5 MiB minimum. */
  partSize?: number;
  /** Force multipart for every upload, regardless of size. */
  forceMultipart?: boolean;
}

export class S3Driver implements BaseDriver<{ bucket: string; etag?: string }> {
  readonly name = "s3";
  private config: Required<Pick<S3DriverConfig, "region">> & S3DriverConfig;
  private baseUrl: string;
  private partSize: number;

  constructor(config: S3DriverConfig) {
    this.config = { region: "us-east-1", ...config };
    this.baseUrl = config.baseUrl ?? resolveBaseUrl(this.config);
    this.partSize = Math.max(config.partSize ?? DEFAULT_PART_SIZE, MIN_PART_SIZE);
  }

  async upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
  ): Promise<UploadResult<{ bucket: string; etag?: string }>> {
    validateUploadOptions(options);

    const id = randomUUID();
    const ext = options.filename.includes(".")
      ? options.filename.split(".").pop()!
      : "";
    const filename = ext ? `${id}.${ext}` : id;
    const key = options.path ? `${options.path}/${filename}` : filename;

    const cred = getCredentials(this.config);

    const metaHeaders = options.metadata
      ? Object.fromEntries(
          Object.entries(options.metadata).map(([k, v]) => [
            `x-amz-meta-${k.toLowerCase()}`,
            v,
          ]),
        )
      : {};

    const typeHeader = options.mimeType ?? "application/octet-stream";

    // Multipart: unknown size (memory-safe without buffering the whole file),
    // sizes beyond the 5 GiB single-PUT cap, or when explicitly requested.
    const useMultipart =
      options.size === undefined || options.size > SINGLE_PUT_MAX || this.config.forceMultipart === true;

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
      response = await fetch(url, {
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
      } as RequestInit);
    } catch (err) {
      // An errored body (e.g. size mismatch) surfaces as a generic `fetch
      // failed`; rethrow the specific ValidationError when present.
      if (bodyError.current) throw bodyError.current;
      throw err;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`S3 upload failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`);
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
      cred: { accessKeyId: string; secretAccessKey: string };
      signal?: AbortSignal;
      expectedSize?: number;
    },
  ): Promise<UploadResult<{ bucket: string; etag?: string }>> {
    const { id, key, metaHeaders, typeHeader, signal, expectedSize } = args;
    const cred = { ...args.cred, region: this.config.region!, service: SERVICE };
    const now = new Date();

    // 1. CreateMultipartUpload — object metadata and content-type live here.
    const create = buildEndpoint(this.config, key, { uploads: "" });
    const createHeaders = await sign(
      "POST",
      create.canonicalPath,
      { host: create.host, "content-type": typeHeader, ...metaHeaders },
      SHA256_EMPTY,
      cred,
      now,
      { uploads: "" },
    );
    const createRes = await fetch(create.url, {
      method: "POST",
      headers: { ...createHeaders, ...metaHeaders, "content-type": typeHeader },
      signal: signal ?? null,
    });
    if (!createRes.ok) {
      const body = await createRes.text().catch(() => "");
      throw new Error(`S3 multipart create failed: ${createRes.status} ${createRes.statusText}${body ? ` — ${body}` : ""}`);
    }
    const uploadId = extractXml(await createRes.text(), "UploadId");
    if (!uploadId) {
      throw new Error("S3 multipart create returned no UploadId");
    }

    const abort = () => this.abortMultipart(key, uploadId, cred, now);

    // 2. UploadPart — stream into one part-sized buffer at a time, so peak
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
        now,
        { partNumber: String(partNumber), uploadId },
      );
      let res: Response;
      try {
        res = await fetch(part.url, {
          method: "PUT",
          headers: { ...partSig, "content-length": String(bytes.byteLength) },
          body: bytes as BodyInit,
          signal: signal ?? null,
        });
      } catch (err) {
        // Includes abort: undo the server-side multipart session, then rethrow
        // the original error (an AbortError when the user cancelled).
        await abort();
        throw err;
      }
      if (!res.ok) {
        await abort();
        throw new Error(`S3 multipart part ${partNumber} failed: ${res.status} ${res.statusText}`);
      }
      const etag = res.headers.get("etag");
      parts.push({ partNumber: partNumber++, etag: etag ?? `"${await sha256(bytes)}"` });
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        await ensureNotAborted();
        if (done) break;
        totalBytes += value.byteLength;
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
        now,
        { uploadId },
      );
      const completeRes = await fetch(complete.url, {
        method: "POST",
        headers: { ...completeHeaders, "content-type": "application/xml" },
        body: xmlBytes,
        signal: signal ?? null,
      });
      if (!completeRes.ok) {
        await abort();
        throw new Error(`S3 multipart complete failed: ${completeRes.status} ${completeRes.statusText}`);
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
    baseCred: { accessKeyId: string; secretAccessKey: string },
    signal?: AbortSignal,
  ): Promise<UploadResult<{ bucket: string; etag?: string }>> {
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

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        ...sigHeaders,
        ...metaHeaders,
        "content-type": typeHeader,
        "content-length": String(bytes.byteLength),
      },
      body: bytes as BodyInit,
      signal: signal ?? null,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`S3 upload failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`);
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
    cred: { accessKeyId: string; secretAccessKey: string; region: string; service: string },
    now: Date,
  ): Promise<void> {
    try {
      const abort = buildEndpoint(this.config, key, { uploadId });
      const headers = await sign("DELETE", abort.canonicalPath, { host: abort.host }, SHA256_EMPTY, cred, now);
      await fetch(abort.url, { method: "DELETE", headers });
    } catch {
      // Best-effort cleanup; the original error is the important one.
    }
  }

  async delete(path: string): Promise<boolean> {
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

    const response = await fetch(url, { method: "DELETE", headers: sigHeaders });
    return response.ok;
  }

  async getUrl(path: string): Promise<string> {
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

  async get(path: string): Promise<ReadableStream<Uint8Array>> {
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

    const response = await fetch(url, { method: "GET", headers: sigHeaders });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`S3 get failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`);
    }

    if (!response.body) {
      throw new Error("S3 get returned no response body");
    }

    return response.body;
  }
}

function getCredentials(config: S3DriverConfig): { accessKeyId: string; secretAccessKey: string } {
  if (config.credentials) return config.credentials;
  throw new Error("S3Driver requires credentials in config");
}

function buildEndpoint(
  config: S3DriverConfig,
  key: string,
  query?: Record<string, string>,
): { url: string; canonicalPath: string; host: string } {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const qs = query ? buildCanonicalQueryString(query) : "";
  const suffix = qs ? `?${qs}` : "";

  if (config.endpoint) {
    const base = config.endpoint.replace(/\/+$/, "");
    const host = new URL(base).host;
    return {
      url: `${base}/${config.bucket}/${encodedKey}${suffix}`,
      canonicalPath: `/${config.bucket}/${encodedKey}`,
      host,
    };
  }

  const host = `${config.bucket}.s3.${config.region ?? "us-east-1"}.amazonaws.com`;
  return {
    url: `https://${host}/${encodedKey}${suffix}`,
    canonicalPath: `/${encodedKey}`,
    host,
  };
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
  if (config.endpoint) {
    const base = config.endpoint.replace(/\/+$/, "");
    return `${base}/${config.bucket}`;
  }
  return `https://${config.bucket}.s3.${config.region ?? "us-east-1"}.amazonaws.com`;
}
