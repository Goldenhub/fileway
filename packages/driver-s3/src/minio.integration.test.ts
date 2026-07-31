import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { FilewayClient } from "@fileway/core";
import { S3Driver } from "./index.js";
import { sign } from "./sigv4.js";

const SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const enabled = process.env.RUN_MINIO_TESTS === "1";
const describeEnv = enabled ? describe : describe.skip;

if (enabled) {
  vi.setConfig({ testTimeout: 30_000 });
}

describeEnv("S3Driver integration against MinIO", () => {
  const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";
  const bucket = process.env.S3_BUCKET ?? "fileway-minio-tests";
  const accessKeyId = process.env.MINIO_ACCESS_KEY ?? "minioadmin";
  const secretAccessKey = process.env.MINIO_SECRET_KEY ?? "minioadmin";

  const base = endpoint.replace(/\/+$/, "");
  const host = new URL(base).host;
  const cred = { accessKeyId, secretAccessKey, region: "us-east-1", service: "s3" };

  let client: FilewayClient<{ driver: S3Driver }>;

  async function s3Request(
    method: string,
    key: string,
    body?: Uint8Array,
  ): Promise<Response> {
    const payloadHash = body ? await sha256Hex(body) : SHA256_EMPTY;
    const canonicalPath = `/${bucket}/${key}`;
    const headers = await sign(
      method,
      canonicalPath,
      { host },
      payloadHash,
      cred,
      new Date(),
    );
    const init: RequestInit = {
      method,
      headers,
      ...(body ? { body: new Uint8Array(body) } : {}),
    };
    return fetch(`${base}${canonicalPath}`, init);
  }

  beforeAll(async () => {
    const create = await fetch(`${base}/${bucket}`, {
      method: "PUT",
      headers: await sign("PUT", `/${bucket}`, { host }, SHA256_EMPTY, cred, new Date()),
    });
    if (!create.ok && create.status !== 409) {
      throw new Error(`failed to create bucket: ${create.status} ${await create.text()}`);
    }

    client = new FilewayClient({
      driver: new S3Driver({
        bucket,
        region: "us-east-1",
        endpoint: base,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      }),
    });
  });

  afterAll(async () => {
    await fetch(`${base}/${bucket}`, {
      method: "DELETE",
      headers: await sign("DELETE", `/${bucket}`, { host }, SHA256_EMPTY, cred, new Date()),
    }).catch(() => {});
  });

  it("uploads a file, reads it back, and deletes it", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello minio"));
        controller.close();
      },
    });

    const result = await client.upload(stream, {
      filename: "hello.txt",
      path: "uploads",
      mimeType: "text/plain",
      metadata: { env: "ci" },
    });

    expect(result.size).toBe(11);
    expect(result.path).toMatch(/^uploads\/[0-9a-f-]+\.txt$/);
    expect(result.meta.bucket).toBe(bucket);
    expect(result.url).toBe(`${base}/${bucket}/${result.path}`);

    const read = await s3Request("GET", result.path);
    expect(read.ok).toBe(true);
    expect(await read.text()).toBe("hello minio");

    const deleted = await client.delete(result.path);
    expect(deleted).toBe(true);

    const gone = await s3Request("GET", result.path);
    expect(gone.ok).toBe(false);
  });

  it("keeps filenames unique across uploads", async () => {
    const upload = () =>
      client.upload(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("same content"));
            controller.close();
          },
        }),
        { filename: "dup.txt" },
      );

    const a = await upload();
    const b = await upload();
    expect(a.path).not.toBe(b.path);

    await client.delete(a.path);
    await client.delete(b.path);
  });

  it("streams a known-size file via aws-chunked and reads it back intact", async () => {
    const bytes = new TextEncoder().encode("streamed-payload-".repeat(5000));
    const chunkSize = 1024;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunkSize) {
          controller.enqueue(bytes.subarray(i, i + chunkSize));
        }
        controller.close();
      },
    });

    const result = await client.upload(stream, {
      filename: "streamed.bin",
      path: "uploads",
      size: bytes.length,
      mimeType: "application/octet-stream",
    });

    expect(result.size).toBe(bytes.length);
    expect(result.meta.bucket).toBe(bucket);

    const read = await s3Request("GET", result.path);
    expect(read.ok).toBe(true);
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);

    const deleted = await client.delete(result.path);
    expect(deleted).toBe(true);
  });

  it("uploads a large file via multipart (multiple parts) and reads it back intact", async () => {
    const client = new FilewayClient({
      driver: new S3Driver({
        bucket,
        region: "us-east-1",
        endpoint: base,
        forcePathStyle: true,
        partSize: 5 * 1024 * 1024,
        credentials: { accessKeyId, secretAccessKey },
      }),
    });

    const bytes = new TextEncoder().encode("x".repeat(11 * 1024 * 1024));
    const chunkSize = 512 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunkSize) {
          controller.enqueue(bytes.subarray(i, i + chunkSize));
        }
        controller.close();
      },
    });

    const result = await client.upload(stream, {
      filename: "large.bin",
      path: "uploads",
      size: bytes.length,
    });

    expect(result.size).toBe(bytes.length);
    expect(result.meta.bucket).toBe(bucket);

    const read = await s3Request("GET", result.path);
    expect(read.ok).toBe(true);
    expect(await read.arrayBuffer()).toSatisfy((buf: ArrayBuffer) => bytesEqual(new Uint8Array(buf), bytes));

    await client.delete(result.path);
  });

  it("uses multipart for unknown sizes and aborts a mismatched upload", async () => {
    const client = new FilewayClient({
      driver: new S3Driver({
        bucket,
        region: "us-east-1",
        endpoint: base,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      }),
    });

    const bytes = new TextEncoder().encode("payload-without-known-size");
    const result = await client.upload(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      { filename: "unknown-size.txt" },
    );
    expect(result.size).toBe(bytes.length);

    const read = await s3Request("GET", result.path);
    expect(read.ok).toBe(true);
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
    await client.delete(result.path);

    // Declared size that does not match the stream → the driver aborts the
    // multipart upload and throws before anything is stored.
    await expect(
      client.upload(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("short"));
            controller.close();
          },
        }),
        { filename: "mismatch.bin", size: 1000 },
      ),
    ).rejects.toThrow(/expected 1000/);
  });
});

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
