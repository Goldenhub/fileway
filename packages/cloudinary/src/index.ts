import type { BaseDriver, PresignedUrlOptions, StorageErrorCode, UploadOptions, UploadResult } from "@fileway/core";
import { validateUploadOptions, ValidationError, isAbortError, abortError, StorageError } from "@fileway/core";

const randomUUID = () => globalThis.crypto.randomUUID();
const PRESIGN_DEFAULT_EXPIRY = 3600;
const PRESIGN_MIN_EXPIRY = 1;
// Cloudinary requires every chunk but the last to be larger than 5 MB.
const MIN_CHUNK_SIZE = 5 * 1024 * 1024;
const DEFAULT_CHUNK_SIZE = 20 * 1024 * 1024;
const DEFAULT_CACHE_SIZE = 1000;

/**
 * How an asset can be accessed:
 * - `upload`: public; anyone with the URL can fetch it.
 * - `authenticated`: originals and derived versions need a signed URL.
 * - `private`: originals need a signed URL; transformed versions are public.
 */
export type CloudinaryDeliveryType = "upload" | "authenticated" | "private";

export interface CloudinaryDriverConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  defaultFolder?: string;
  maxSizeBytes?: number;
  /** Chunk size in bytes for chunked uploads. Default 20 MiB, clamped to a
   * 5 MiB minimum. Peak memory per upload is about one chunk. */
  chunkSize?: number;
  /** Maximum number of public IDs whose resource type/version/format are
   * cached in memory. Oldest entries are evicted first. Default 1000. */
  cacheSize?: number;
  /** Delivery type for new uploads, and the type assumed for lookups when
   * none is given or found. Default `upload` (public). */
  deliveryType?: CloudinaryDeliveryType;
}

export interface CloudinaryUploadOptions extends UploadOptions {
  /** Delivery type for this upload. Overrides the driver's `deliveryType`. */
  deliveryType?: CloudinaryDeliveryType;
}

export interface CloudinaryMeta extends Record<string, unknown> {
  publicId: string;
  version: number;
  format: string;
  resourceType: "image" | "video" | "raw";
  deliveryType: CloudinaryDeliveryType;
  bytes: number;
  /** URL returned by Cloudinary. For `authenticated`/`private` assets it is
   * unsigned and will be refused; use `getUrl` for a signed one. */
  secureUrl: string;
  width?: number;
  height?: number;
}

export interface CloudinaryLookupOptions {
  /**
   * The asset's resource type. Cloudinary does not encode the resource type in
   * a public ID, so it is resolved from cache or the Admin API when omitted and
   * defaults to `image`. Pass it explicitly to skip the network lookup.
   */
  resourceType?: "image" | "video" | "raw";
  /** Explicit asset version, used to build the CDN URL. */
  version?: number;
  /** Explicit file format (e.g. `png`), used by `getPresignedUrl` and signed URLs. */
  format?: string;
  /**
   * The asset's delivery type. Resolved from cache or the Admin API when
   * omitted, falling back to the driver's `deliveryType`. The same public ID
   * can exist under several delivery types; pass this to pick one.
   */
  deliveryType?: CloudinaryDeliveryType;
}

export interface CloudinaryPresignOptions extends PresignedUrlOptions, CloudinaryLookupOptions {}

interface CachedAsset {
  resourceType: "image" | "video" | "raw";
  deliveryType: CloudinaryDeliveryType;
  version?: number;
  format?: string;
}

interface ResolvedAsset extends CachedAsset {
  found: boolean;
  secureUrl?: string;
}

interface UploadResponse {
  public_id: string;
  version: number;
  format: string;
  resource_type: "image" | "video" | "raw";
  type?: CloudinaryDeliveryType;
  bytes: number;
  secure_url: string;
  width?: number;
  height?: number;
}

export class CloudinaryDriver implements BaseDriver<CloudinaryMeta> {
  readonly name = "cloudinary";
  private cloudName: string;
  private apiKey: string;
  private apiSecret: string;
  private maxSizeBytes: number | undefined;
  private chunkSize: number;
  private cacheSize: number;
  private deliveryType: CloudinaryDeliveryType;
  private cache = new Map<string, CachedAsset>();

  constructor(config: CloudinaryDriverConfig) {
    this.cloudName = config.cloudName;
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.maxSizeBytes = config.maxSizeBytes;
    this.chunkSize = Math.max(config.chunkSize ?? DEFAULT_CHUNK_SIZE, MIN_CHUNK_SIZE);
    this.cacheSize = config.cacheSize ?? DEFAULT_CACHE_SIZE;
    this.deliveryType = config.deliveryType ?? "upload";
  }

  /**
   * Uploads the stream without buffering it whole. Files up to `chunkSize`
   * go up in a single request; larger ones use Cloudinary's chunked upload
   * (`X-Unique-Upload-Id` + `Content-Range`), so peak memory stays at about
   * one chunk regardless of file size.
   */
  async upload(stream: ReadableStream<Uint8Array>, options: CloudinaryUploadOptions): Promise<UploadResult<CloudinaryMeta>> {
    validateUploadOptions(options);

    const { signal } = options;
    const deliveryType = options.deliveryType ?? this.deliveryType;
    // `upload` is Cloudinary's default, so it is not sent (keeps signatures
    // identical to a plain upload).
    const type = deliveryType === "upload" ? undefined : deliveryType;
    const uploadId = randomUUID();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await this.generateSignature({ timestamp, folder: options.path, type });

    const sendChunk = async (bytes: Uint8Array, range?: string): Promise<Response> => {
      const formData = new FormData();
      formData.append("file", new Blob([bytes as BlobPart]), options.filename);
      formData.append("api_key", this.apiKey);
      formData.append("timestamp", timestamp);
      if (options.path) formData.append("folder", options.path);
      if (type) formData.append("type", type);
      formData.append("signature", signature);

      const res = await fetchWithAbort(
        `https://api.cloudinary.com/v1_1/${this.cloudName}/auto/upload`,
        {
          method: "POST",
          body: formData,
          ...(range !== undefined ? { headers: { "x-unique-upload-id": uploadId, "content-range": range } } : {}),
          signal: signal ?? null,
        },
        "cloudinary",
      );
      if (!res.ok) {
        throw new StorageError(classifyCloudinaryStatus(res.status, "upload"), `Cloudinary HTTP Upload Failed (${res.status})`, {
          statusCode: res.status,
          provider: "cloudinary",
        });
      }
      return res;
    };

    const reader = stream.getReader();
    const onAbort = () => {
      // Cancelling the reader wakes any pending `read()`, so an abort is
      // noticed even when the producer is mid-stream.
      reader.cancel().catch(() => {});
    };
    if (signal && !signal.aborted) signal.addEventListener("abort", onAbort, { once: true });

    let buffer: Uint8Array[] = [];
    let bufferedLen = 0;
    let totalBytes = 0;
    let sentBytes = 0;
    const declaredTotal = options.size ?? -1;

    try {
      let res: Response | undefined;
      while (true) {
        if (signal?.aborted) throw abortError("upload aborted");
        const { done, value } = await reader.read();
        if (signal?.aborted) throw abortError("upload aborted");
        if (done) break;

        totalBytes += value.byteLength;
        if (this.maxSizeBytes !== undefined && totalBytes > this.maxSizeBytes) {
          throw new StorageError("size-exceeded", `upload exceeds maxSizeBytes of ${this.maxSizeBytes}`, {
            provider: "cloudinary",
          });
        }
        buffer.push(value);
        bufferedLen += value.byteLength;

        // Strictly greater: only send a full chunk once more data follows it,
        // so we always know whether a chunk is the last one.
        while (bufferedLen > this.chunkSize) {
          const merged = concatBytes(buffer, bufferedLen);
          const chunk = merged.subarray(0, this.chunkSize);
          await sendChunk(chunk, `bytes ${sentBytes}-${sentBytes + chunk.byteLength - 1}/${declaredTotal}`);
          sentBytes += chunk.byteLength;
          const rest = merged.subarray(this.chunkSize);
          buffer = [rest];
          bufferedLen = rest.byteLength;
        }
      }

      const last = concatBytes(buffer, bufferedLen);
      res = sentBytes === 0
        // Fits in one chunk: a plain upload, no chunk headers.
        ? await sendChunk(last)
        : await sendChunk(last, `bytes ${sentBytes}-${sentBytes + last.byteLength - 1}/${totalBytes}`);

      const data = (await res.json()) as UploadResponse;
      const storedType = data.type ?? deliveryType;
      this.remember(data.public_id, {
        resourceType: data.resource_type,
        deliveryType: storedType,
        version: data.version,
        ...(data.format ? { format: data.format } : {}),
      });

      return {
        id: data.public_id,
        url: data.secure_url,
        path: data.public_id,
        size: data.bytes,
        meta: {
          publicId: data.public_id,
          version: data.version,
          format: data.format,
          resourceType: data.resource_type,
          deliveryType: storedType,
          bytes: data.bytes,
          secureUrl: data.secure_url,
          ...(data.width !== undefined ? { width: data.width } : {}),
          ...(data.height !== undefined ? { height: data.height } : {}),
        },
      };
    } catch (err) {
      reader.cancel().catch(() => {});
      throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Deletes the asset. Returns `false` when it does not exist; throws a
   * `StorageError` for any other failure (auth, network, provider).
   */
  async delete(publicId: string, options?: CloudinaryLookupOptions): Promise<boolean> {
    const asset = await this.resolveAsset(publicId, options);
    if (!asset.found) return false;

    const res = await fetchWithAbort(
      `https://api.cloudinary.com/v1_1/${this.cloudName}/resources/${asset.resourceType}/${asset.deliveryType}?public_ids[]=${encodeURIComponent(publicId)}`,
      { method: "DELETE", headers: { authorization: this.adminAuth() } },
      "cloudinary",
    );
    if (!res.ok) {
      throw new StorageError(classifyCloudinaryStatus(res.status, "upload"), `Cloudinary delete failed (${res.status})`, {
        statusCode: res.status,
        provider: "cloudinary",
      });
    }

    const data = (await res.json()) as { deleted?: Record<string, string> };
    const status = data.deleted?.[publicId];
    if (status === "deleted" || status === "not_found") {
      this.cache.delete(publicId);
    }
    if (status === "deleted") return true;
    if (status === "not_found") return false;
    throw new StorageError("provider-error", `Cloudinary delete returned unexpected status: ${status ?? "none"}`, {
      provider: "cloudinary",
    });
  }

  /**
   * Returns the delivery URL. Public (`upload`) assets get a plain CDN URL;
   * `authenticated` and `private` assets get a signed, non-expiring URL (see
   * `getSignedUrl`), since Cloudinary refuses unsigned requests for them.
   */
  async getUrl(publicId: string, options?: CloudinaryLookupOptions): Promise<string> {
    const asset = await this.resolveAsset(publicId, options);
    if (asset.deliveryType !== "upload") return this.signedDeliveryUrl(publicId, asset);
    if (asset.secureUrl) return asset.secureUrl;
    const versionStr = asset.version !== undefined ? `/v${asset.version}` : "";
    return `https://res.cloudinary.com/${this.cloudName}/${asset.resourceType}/upload${versionStr}/${publicId}`;
  }

  async get(publicId: string, options?: CloudinaryLookupOptions): Promise<ReadableStream<Uint8Array>> {
    const url = await this.getUrl(publicId, options);
    const response = await fetchWithAbort(url, {}, "cloudinary");
    if (!response.ok) {
      throw new StorageError(classifyCloudinaryStatus(response.status, "get"), `Cloudinary get failed: ${response.status} ${response.statusText}`, {
        statusCode: response.status,
        provider: "cloudinary",
      });
    }
    if (!response.body) {
      throw new StorageError("provider-error", "Cloudinary get returned no response body", { provider: "cloudinary" });
    }
    return response.body;
  }

  /**
   * Returns a signed, time-limited download URL that stops working
   * `expiresIn` seconds from now. Uses Cloudinary's private download API
   * (`/v1_1/<cloud>/<resource_type>/download`), which enforces `expires_at`
   * for every delivery type. Delivery URLs on `res.cloudinary.com` cannot
   * expire without token-based authentication (a premium feature); for a
   * signed but non-expiring delivery URL, use `getSignedUrl`.
   */
  async getPresignedUrl(publicId: string, options?: CloudinaryPresignOptions): Promise<string> {
    const expiresIn = options?.expiresIn ?? PRESIGN_DEFAULT_EXPIRY;
    if (!Number.isInteger(expiresIn) || expiresIn < PRESIGN_MIN_EXPIRY) {
      throw new ValidationError(`expiresIn must be a positive integer`);
    }

    const asset = await this.resolveAsset(publicId, options);
    const now = Math.floor(Date.now() / 1000);
    const params: Record<string, string> = {
      public_id: publicId,
      type: asset.deliveryType,
      expires_at: String(now + expiresIn),
      timestamp: String(now),
      ...(asset.format ? { format: asset.format } : {}),
    };
    const signature = await this.generateSignature(params);
    const query = new URLSearchParams({ ...params, signature, api_key: this.apiKey });

    return `https://api.cloudinary.com/v1_1/${this.cloudName}/${asset.resourceType}/download?${query}`;
  }

  /**
   * Returns a signed delivery URL on `res.cloudinary.com`. The signature is
   * the first 8 characters of a URL-safe base64 SHA-1 digest of the resource
   * path (version, public ID and extension, as they appear in the URL)
   * concatenated with the API secret. It is required for `authenticated` and
   * `private` assets and does not expire; use `getPresignedUrl` for a
   * time-limited link.
   */
  async getSignedUrl(publicId: string, options?: CloudinaryLookupOptions): Promise<string> {
    return this.signedDeliveryUrl(publicId, await this.resolveAsset(publicId, options));
  }

  private async signedDeliveryUrl(publicId: string, asset: ResolvedAsset): Promise<string> {
    // Raw public IDs already carry their extension; images and videos get the
    // format appended, matching the URLs Cloudinary itself returns.
    const file = asset.format && asset.resourceType !== "raw" ? `${publicId}.${asset.format}` : publicId;
    const resourcePath = asset.version !== undefined ? `v${asset.version}/${file}` : file;
    const signature = await this.generateDeliverySignature(resourcePath);

    return `https://res.cloudinary.com/${this.cloudName}/${asset.resourceType}/${asset.deliveryType}/s--${signature}--/${resourcePath}`;
  }

  /**
   * Resolve the resource type, delivery type, version and format for a public
   * ID: explicit hint → in-memory cache → Admin API lookup → defaults
   * (`image`, the driver's `deliveryType`).
   */
  private async resolveAsset(publicId: string, options?: CloudinaryLookupOptions): Promise<ResolvedAsset> {
    const wantedType = options?.deliveryType;

    if (options?.resourceType !== undefined) {
      return {
        found: true,
        resourceType: options.resourceType,
        deliveryType: wantedType ?? this.cache.get(publicId)?.deliveryType ?? this.deliveryType,
        ...(options.version !== undefined ? { version: options.version } : {}),
        ...(options.format !== undefined ? { format: options.format } : {}),
      };
    }

    const cached = this.cache.get(publicId);
    // A cached entry for a different delivery type is a different asset.
    if (cached !== undefined && (wantedType === undefined || cached.deliveryType === wantedType)) {
      // Refresh recency so frequently used IDs survive eviction.
      this.remember(publicId, cached);
      return { found: true, ...cached };
    }

    const found = await this.lookupResource(publicId, wantedType);
    if (found) return found;

    return { found: false, resourceType: "image", deliveryType: wantedType ?? this.deliveryType };
  }

  /** Looks the public ID up via the Admin Search API. Returns `null` when no
   * asset matches; throws a `StorageError` when the lookup itself fails. */
  private async lookupResource(publicId: string, deliveryType?: CloudinaryDeliveryType): Promise<ResolvedAsset | null> {
    const expression = deliveryType === undefined
      ? `public_id="${escapeSearchValue(publicId)}"`
      : `public_id="${escapeSearchValue(publicId)}" AND type=${deliveryType}`;
    const res = await fetchWithAbort(
      `https://api.cloudinary.com/v1_1/${this.cloudName}/resources/search`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: this.adminAuth(),
        },
        body: JSON.stringify({ expression, max_results: 1 }),
      },
      "cloudinary",
    );
    if (!res.ok) {
      throw new StorageError(classifyCloudinaryStatus(res.status, "upload"), `Cloudinary lookup failed (${res.status})`, {
        statusCode: res.status,
        provider: "cloudinary",
      });
    }

    const data = (await res.json()) as {
      resources?: Array<{ resource_type?: string; type?: string; version?: number; secure_url?: string; format?: string }>;
    };
    const resource = data.resources?.[0];
    if (!resource?.resource_type) return null;

    const asset: CachedAsset = {
      resourceType: resource.resource_type as CachedAsset["resourceType"],
      deliveryType: (resource.type as CloudinaryDeliveryType | undefined) ?? deliveryType ?? this.deliveryType,
      ...(resource.version !== undefined ? { version: resource.version } : {}),
      ...(resource.format ? { format: resource.format } : {}),
    };
    this.remember(publicId, asset);

    return {
      found: true,
      ...asset,
      ...(resource.secure_url ? { secureUrl: resource.secure_url } : {}),
    };
  }

  /** Caches an asset, evicting the least recently used entry when full. */
  private remember(publicId: string, asset: CachedAsset): void {
    if (this.cacheSize <= 0) return;
    this.cache.delete(publicId);
    this.cache.set(publicId, asset);
    if (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  private adminAuth(): string {
    return `Basic ${btoa(`${this.apiKey}:${this.apiSecret}`)}`;
  }

  private async generateDeliverySignature(resourcePath: string): Promise<string> {
    const hash = await globalThis.crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(resourcePath + this.apiSecret),
    );
    return base64UrlEncode(new Uint8Array(hash)).slice(0, 8);
  }

  private async generateSignature(params: Record<string, string | undefined>): Promise<string> {
    const sortedKeys = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== "")
      .sort();

    // Signature version 2: an `&` inside a value is encoded so it cannot be
    // confused with the pair separator.
    const paramString =
      sortedKeys.map((k) => `${k}=${params[k]}`.replace(/&/g, "%26")).join("&") + this.apiSecret;

    const encoder = new TextEncoder();
    const data = encoder.encode(paramString);
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-1", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1 && chunks[0]!.byteLength === total) return chunks[0]!;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Escapes a value for use inside double quotes in a Search API expression. */
function escapeSearchValue(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

/** Classifies a Cloudinary HTTP status. Context separates a 404 on the CDN
 * (missing asset → `not-found`) from one on the upload/admin API (unknown
 * cloud → `bucket-not-found`). Cloudinary signals rate limiting with 420. */
function classifyCloudinaryStatus(status: number, context: "upload" | "get"): StorageErrorCode {
  if (status === 401 || status === 403) return "auth-failed";
  if (status === 404) return context === "upload" ? "bucket-not-found" : "not-found";
  if (status === 413) return "size-exceeded";
  return "provider-error";
}
