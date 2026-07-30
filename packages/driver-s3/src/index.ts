import type { BaseDriver, UploadOptions, UploadResult } from "@betterpush/core";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";

const randomUUID = () => globalThis.crypto.randomUUID();

export interface S3DriverConfig {
  bucket: string;
  region?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  baseUrl?: string;
  endpoint?: string;
}

export class S3Driver implements BaseDriver<{ bucket: string; etag?: string }> {
  readonly name = "s3";
  private client: S3Client;
  private bucket: string;
  private baseUrl: string;

  constructor(config: S3DriverConfig) {
    this.client = new S3Client({
      ...(config.region ? { region: config.region } : {}),
      ...(config.credentials ? { credentials: config.credentials } : {}),
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      requestHandler: new FetchHttpHandler(),
    });
    this.bucket = config.bucket;
    this.baseUrl = config.baseUrl ?? resolveBaseUrl(config);
  }

  async upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
  ): Promise<UploadResult<{ bucket: string; etag?: string }>> {
    const id = randomUUID();
    const ext = options.filename.includes(".")
      ? options.filename.split(".").pop()!
      : "";
    const filename = ext ? `${id}.${ext}` : id;
    const key = options.path ? `${options.path}/${filename}` : filename;

    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: options.mimeType,
        Metadata: options.metadata,
      }),
    );

    return {
      id,
      url: `${this.baseUrl}/${key}`,
      path: key,
      size: 0,
      meta: {
        bucket: this.bucket,
        ...(result.ETag ? { etag: result.ETag } : {}),
      },
    };
  }

  async delete(path: string): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: path }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async getUrl(path: string): Promise<string> {
    return `${this.baseUrl}/${path}`;
  }
}

function resolveBaseUrl(config: S3DriverConfig): string {
  if (config.endpoint) {
    const base = config.endpoint.replace(/\/+$/, "");
    return `${base}/${config.bucket}`;
  }
  return `https://${config.bucket}.s3.${config.region ?? "us-east-1"}.amazonaws.com`;
}
