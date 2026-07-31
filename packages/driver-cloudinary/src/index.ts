import type { BaseDriver, UploadOptions, UploadResult } from "@betterpush/core";
import { validateUploadOptions, ValidationError, urlEncodePath } from "@betterpush/core";

const randomUUID = () => globalThis.crypto.randomUUID();

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

    const res = await fetch(`https://api.cloudinary.com/v1_1/${this.cloudName}/auto/upload`, { method: "POST", body: formData });

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

  async delete(publicId: string): Promise<boolean> {
    try {
      const resourceType = this.resourceTypes.get(publicId) ?? "image";
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = await this.generateSignature({
        public_id: publicId,
        timestamp,
      });

      const formData = new FormData();
      formData.append("public_id", publicId);
      formData.append("api_key", this.apiKey);
      formData.append("timestamp", timestamp);
      formData.append("signature", signature);

      const res = await fetch(`https://api.cloudinary.com/v1_1/${this.cloudName}/${resourceType}/destroy`, { method: "POST", body: formData });

      const data = (await res.json()) as { result: string };
      const deleted = data.result === "ok";
      if (deleted) {
        this.resourceTypes.delete(publicId);
        this.versions.delete(publicId);
      }
      return deleted;
    } catch {
      return false;
    }
  }

  async getUrl(publicId: string): Promise<string> {
    const resourceType = this.resourceTypes.get(publicId) ?? "image";
    const version = this.versions.get(publicId);
    const versionStr = version !== undefined ? `/v${version}` : "";
    return `https://res.cloudinary.com/${this.cloudName}/${resourceType}/upload${versionStr}/${publicId}`;
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
