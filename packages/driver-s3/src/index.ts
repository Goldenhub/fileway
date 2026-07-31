import type { BaseDriver, UploadOptions, UploadResult } from "@fileway/core";
import { validateUploadOptions, urlEncodePath } from "@fileway/core";
import { sign, signChunkedBody, sha256 } from "./sigv4.js";

const randomUUID = () => globalThis.crypto.randomUUID();
const SERVICE = "s3";

export interface S3DriverConfig {
  bucket: string;
  region?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  baseUrl?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

export class S3Driver implements BaseDriver<{ bucket: string; etag?: string }> {
  readonly name = "s3";
  private config: Required<Pick<S3DriverConfig, "region">> & S3DriverConfig;
  private baseUrl: string;

  constructor(config: S3DriverConfig) {
    this.config = { region: "us-east-1", ...config };
    this.baseUrl = config.baseUrl ?? resolveBaseUrl(this.config);
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

    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalSize += value.byteLength;
    }

    const fullBody = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      fullBody.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const payloadHash = await sha256(fullBody);

    const now = new Date();
    const { url, canonicalPath, host } = buildEndpoint(this.config, key);

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

    const sigHeaders = await sign(
      "PUT",
      canonicalPath,
      {
        "host": host,
        "content-type": typeHeader,
        ...metaHeaders,
      },
      payloadHash,
      { ...cred, region: this.config.region!, service: SERVICE },
      now,
    );

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        ...sigHeaders,
        ...metaHeaders,
        "content-type": typeHeader,
        "content-length": String(totalSize),
      },
      body: fullBody,
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
      size: totalSize,
      meta: {
        bucket: this.config.bucket,
        ...(etag ? { etag } : {}),
      },
    };
  }

  async delete(path: string): Promise<boolean> {
    const cred = getCredentials(this.config);
    const { url, canonicalPath, host } = buildEndpoint(this.config, path);
    const now = new Date();

    const sigHeaders = await sign(
      "DELETE",
      canonicalPath,
      { "host": host },
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      { ...cred, region: this.config.region!, service: SERVICE },
      now,
    );

    const response = await fetch(url, { method: "DELETE", headers: sigHeaders });
    return response.ok;
  }

  async getUrl(path: string): Promise<string> {
    return `${this.baseUrl}/${urlEncodePath(path)}`;
  }
}

function getCredentials(config: S3DriverConfig): { accessKeyId: string; secretAccessKey: string } {
  if (config.credentials) return config.credentials;
  throw new Error("S3Driver requires credentials in config");
}

function buildEndpoint(
  config: S3DriverConfig,
  key: string,
): { url: string; canonicalPath: string; host: string } {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");

  if (config.endpoint) {
    const base = config.endpoint.replace(/\/+$/, "");
    const host = new URL(base).host;
    return {
      url: `${base}/${config.bucket}/${encodedKey}`,
      canonicalPath: `/${config.bucket}/${encodedKey}`,
      host,
    };
  }

  const host = `${config.bucket}.s3.${config.region ?? "us-east-1"}.amazonaws.com`;
  return {
    url: `https://${host}/${encodedKey}`,
    canonicalPath: `/${encodedKey}`,
    host,
  };
}

function resolveBaseUrl(config: S3DriverConfig): string {
  if (config.endpoint) {
    const base = config.endpoint.replace(/\/+$/, "");
    return `${base}/${config.bucket}`;
  }
  return `https://${config.bucket}.s3.${config.region ?? "us-east-1"}.amazonaws.com`;
}
