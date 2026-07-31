import type { BaseDriver, PresignedUrlOptions, UploadOptions, UploadResult } from "@fileway/core";
import { validateUploadOptions, ValidationError, urlEncodePath } from "@fileway/core";

const randomUUID = () => globalThis.crypto.randomUUID();
const PRESIGN_DEFAULT_EXPIRY = 3600;
const PRESIGN_MIN_EXPIRY = 1;

export interface CloudinaryDriverConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  defaultFolder?: string;
  maxSizeBytes?: number;
}

export interface CloudinaryMeta extends Record<string, unknown> {
  publicId: string;
  version: number;
  format: string;
  resourceType: "image" | "video" | "raw";
  bytes: number;
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
}

export interface CloudinaryPresignOptions extends PresignedUrlOptions, CloudinaryLookupOptions {
  /**
   * Delivery type used in the signed URL. Defaults to `upload` to match assets
   * created by `CloudinaryDriver.upload`. Use `authenticated` (or `private`)
   * for assets stored under those delivery types — this is where the signature
   * actually restricts access until `expires_at`. The value must match the
   * asset's delivery type or Cloudinary returns 404.
   */
  deliveryType?: "upload" | "authenticated" | "private";
}

interface ResolvedAsset {
  found: boolean;
  resourceType: "image" | "video" | "raw";
  version?: number;
  secureUrl?: string;
}

export class CloudinaryDriver implements BaseDriver<CloudinaryMeta> {
  readonly name = "cloudinary";
  private cloudName: string;
  private apiKey: string;
  private apiSecret: string;
  private maxSizeBytes: number | undefined;
  private resourceTypes = new Map<string, string>();
  private versions = new Map<string, number>();

  constructor(config: CloudinaryDriverConfig) {
    this.cloudName = config.cloudName;
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.maxSizeBytes = config.maxSizeBytes;
  }

  async upload(stream: ReadableStream<Uint8Array>, options: UploadOptions): Promise<UploadResult<CloudinaryMeta>> {
    validateUploadOptions(options);

    const response = new Response(stream);
    const blob = await response.blob();

    if (this.maxSizeBytes !== undefined && blob.size > this.maxSizeBytes) {
      throw new ValidationError(`upload exceeds maxSizeBytes of ${this.maxSizeBytes}`);
    }

    const formData = new FormData();
    formData.append("file", blob, options.filename);
    formData.append("api_key", this.apiKey);

    const timestamp = Math.floor(Date.now() / 1000).toString();
    formData.append("timestamp", timestamp);

    if (options.path) {
      formData.append("folder", options.path);
    }

    const signature = await this.generateSignature({
      timestamp,
      folder: options.path,
    });
    formData.append("signature", signature);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${this.cloudName}/auto/upload`, { method: "POST", body: formData, signal: options.signal ?? null });

    if (!res.ok) {
      throw new Error(`Cloudinary HTTP Upload Failed (${res.status})`);
    }

    const data = (await res.json()) as {
      public_id: string;
      version: number;
      format: string;
      resource_type: "image" | "video" | "raw";
      bytes: number;
      secure_url: string;
      width?: number;
      height?: number;
    };

    this.resourceTypes.set(data.public_id, data.resource_type);
    this.versions.set(data.public_id, data.version);

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
        bytes: data.bytes,
        secureUrl: data.secure_url,
        ...(data.width !== undefined ? { width: data.width } : {}),
        ...(data.height !== undefined ? { height: data.height } : {}),
      },
    };
  }

  async delete(publicId: string, options?: CloudinaryLookupOptions): Promise<boolean> {
    try {
      const asset = await this.resolveAsset(publicId, options);
      if (!asset.found) return false;

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${this.cloudName}/resources/${asset.resourceType}/upload?public_ids[]=${encodeURIComponent(publicId)}`,
        { method: "DELETE", headers: { authorization: this.adminAuth() } },
      );
      if (!res.ok) return false;

      const data = (await res.json()) as { deleted?: Record<string, string> };
      const status = data.deleted?.[publicId];
      if (status === "deleted" || status === "not_found") {
        this.resourceTypes.delete(publicId);
        this.versions.delete(publicId);
      }
      return status === "deleted";
    } catch {
      return false;
    }
  }

  async getUrl(publicId: string, options?: CloudinaryLookupOptions): Promise<string> {
    const asset = await this.resolveAsset(publicId, options);
    if (asset.secureUrl) return asset.secureUrl;
    const versionStr = asset.version !== undefined ? `/v${asset.version}` : "";
    return `https://res.cloudinary.com/${this.cloudName}/${asset.resourceType}/upload${versionStr}/${publicId}`;
  }

  async get(publicId: string, options?: CloudinaryLookupOptions): Promise<ReadableStream<Uint8Array>> {
    const url = await this.getUrl(publicId, options);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Cloudinary get failed: ${response.status} ${response.statusText}`);
    }
    if (!response.body) {
      throw new Error("Cloudinary get returned no response body");
    }
    return response.body;
  }

  /**
   * Returns a signed Cloudinary delivery URL valid until `expiresIn` seconds
   * from now. The signature is the first 8 characters of a URL-safe base64
   * SHA-1 digest of the resource path (everything after the `s--` component)
   * concatenated with the API secret. Generated purely with Web Crypto.
   *
   * The signature only restricts access for assets with `authenticated` or
   * `private` delivery; for public `upload` assets it is decorative. See
   * `CloudinaryPresignOptions.deliveryType`.
   */
  async getPresignedUrl(publicId: string, options?: CloudinaryPresignOptions): Promise<string> {
    const expiresIn = options?.expiresIn ?? PRESIGN_DEFAULT_EXPIRY;
    if (!Number.isInteger(expiresIn) || expiresIn < PRESIGN_MIN_EXPIRY) {
      throw new ValidationError(`expiresIn must be a positive integer`);
    }

    const asset = await this.resolveAsset(publicId, options);
    const resourcePath = asset.version !== undefined ? `v${asset.version}/${publicId}` : publicId;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    const signature = await this.generateDeliverySignature(resourcePath);
    const deliveryType = options?.deliveryType ?? "upload";

    return `https://res.cloudinary.com/${this.cloudName}/${asset.resourceType}/${deliveryType}/s--${signature}--/${resourcePath}?expires_at=${expiresAt}`;
  }

  /**
   * Resolve the resource type and version for a public ID: explicit hint →
   * in-memory cache → Admin API lookup → default `image`.
   */
  private async resolveAsset(publicId: string, options?: CloudinaryLookupOptions): Promise<ResolvedAsset> {
    if (options?.resourceType !== undefined) {
      return {
        found: true,
        resourceType: options.resourceType,
        ...(options.version !== undefined ? { version: options.version } : {}),
      };
    }

    const cachedType = this.resourceTypes.get(publicId);
    if (cachedType !== undefined) {
      const cachedVersion = this.versions.get(publicId);
      return {
        found: true,
        resourceType: cachedType as ResolvedAsset["resourceType"],
        ...(cachedVersion !== undefined ? { version: cachedVersion } : {}),
      };
    }

    const found = await this.lookupResource(publicId);
    if (found) return found;

    return { found: false, resourceType: "image" };
  }

  private async lookupResource(publicId: string): Promise<ResolvedAsset | null> {
    try {
      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${this.cloudName}/resources/search`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: this.adminAuth(),
          },
          body: JSON.stringify({ expression: `public_id:${publicId}`, max_results: 1 }),
        },
      );
      if (!res.ok) return null;

      const data = (await res.json()) as {
        resources?: Array<{ resource_type?: string; version?: number; secure_url?: string }>;
      };
      const resource = data.resources?.[0];
      if (!resource?.resource_type) return null;

      this.resourceTypes.set(publicId, resource.resource_type);
      if (resource.version !== undefined) this.versions.set(publicId, resource.version);

      return {
        found: true,
        resourceType: resource.resource_type as ResolvedAsset["resourceType"],
        ...(resource.version !== undefined ? { version: resource.version } : {}),
        ...(resource.secure_url ? { secureUrl: resource.secure_url } : {}),
      };
    } catch {
      return null;
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
      .filter((k) => params[k] !== undefined)
      .sort();

    const paramString = sortedKeys.map((k) => `${k}=${params[k]}`).join("&") + this.apiSecret;

    const encoder = new TextEncoder();
    const data = encoder.encode(paramString);
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-1", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
