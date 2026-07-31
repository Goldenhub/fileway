import { describe, it, expect, vi, beforeEach } from "vitest";
import { S3Driver } from "./index.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

function okResponse(etag?: string): Response {
  return new Response(null, {
    status: 200,
    ...(etag ? { headers: { etag } } : {}),
  });
}

describe("S3Driver (AWS S3)", () => {
  let driver: S3Driver;

  beforeEach(() => {
    driver = new S3Driver({
      bucket: "test-bucket",
      region: "us-east-1",
      credentials: { accessKeyId: "AKID", secretAccessKey: "secret" },
    });
  });

  it("should upload a stream", async () => {
    mockFetch.mockResolvedValue(okResponse('"abc123"'));

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data"));
        controller.close();
      },
    });

    const result = await driver.upload(stream, { filename: "test.txt" });

    expect(result.id).toBeDefined();
    expect(result.path).toMatch(/\.txt$/);
    expect(result.meta.bucket).toBe("test-bucket");
    expect(result.meta.etag).toBe('"abc123"');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toContain("test-bucket.s3.us-east-1.amazonaws.com");
    expect(opts.method).toBe("PUT");
    expect(opts.headers["authorization"]).toBeDefined();
    expect(opts.headers["x-amz-content-sha256"]).toBeDefined();
    expect(opts.headers["x-amz-date"]).toBeDefined();
  });

  it("should upload with metadata", async () => {
    mockFetch.mockResolvedValue(okResponse());

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data"));
        controller.close();
      },
    });

    await driver.upload(stream, {
      filename: "test.txt",
      metadata: { userId: "42", source: "mobile" },
    });

    const [, opts] = mockFetch.mock.calls[0]!;
    expect(opts.headers["x-amz-meta-userid"]).toBe("42");
    expect(opts.headers["x-amz-meta-source"]).toBe("mobile");
  });

  it("should delete an object", async () => {
    mockFetch.mockResolvedValue(okResponse());
    const result = await driver.delete("test.txt");
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toContain("test.txt");
    expect(opts.method).toBe("DELETE");
  });

  it("should return false on delete failure", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 404 }));
    const result = await driver.delete("missing.txt");
    expect(result).toBe(false);
  });

  it("should generate a URL", async () => {
    const url = await driver.getUrl("test.txt");
    expect(url).toBe("https://test-bucket.s3.us-east-1.amazonaws.com/test.txt");
  });
});

describe("S3Driver streaming upload (known size)", () => {
  let driver: S3Driver;

  beforeEach(() => {
    driver = new S3Driver({
      bucket: "test-bucket",
      region: "us-east-1",
      credentials: { accessKeyId: "AKID", secretAccessKey: "secret" },
    });
  });

  it("should use the aws-chunked streaming path and never set content-length", async () => {
    mockFetch.mockResolvedValue(okResponse('"abc123"'));

    const payload = new TextEncoder().encode("hello streaming s3");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      },
    });

    const result = await driver.upload(stream, {
      filename: "stream.txt",
      size: payload.byteLength,
    });

    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toContain("test-bucket.s3.us-east-1.amazonaws.com");
    expect(opts.method).toBe("PUT");
    expect(opts.headers["x-amz-content-sha256"]).toBe(
      "STREAMING-AWS4-HMAC-SHA256-PAYLOAD",
    );
    expect(opts.headers["content-encoding"]).toBe("aws-chunked");
    expect(opts.headers["x-amz-decoded-content-length"]).toBe(String(payload.byteLength));
    expect(opts.headers["content-length"]).toBeUndefined();
    expect(opts.body).toBeInstanceOf(ReadableStream);

    const decoded = await decodeAwsChunked(opts.body as ReadableStream<Uint8Array>);
    expect(decoded).toEqual(payload);
    expect(result.size).toBe(payload.byteLength);
  });

  it("should fall back to a buffered PUT when size is unknown", async () => {
    mockFetch.mockResolvedValue(okResponse());

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("buffered"));
        controller.close();
      },
    });

    await driver.upload(stream, { filename: "b.txt" });

    const [, opts] = mockFetch.mock.calls[0]!;
    expect(opts.headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
    expect(opts.headers["content-encoding"]).toBeUndefined();
    expect(opts.headers["content-length"]).toBe("8");
    expect(opts.body).toBeInstanceOf(Uint8Array);
  });
});

async function decodeAwsChunked(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }

  const out: number[] = [];
  const textDecoder = new TextDecoder();
  let i = 0;
  let sawTerminal = false;
  while (i < all.length) {
    let j = i;
    while (j < all.length && all[j] !== 0x0d) j++;
    if (j >= all.length) throw new Error("malformed aws-chunked body: no CR found");
    const header = textDecoder.decode(all.subarray(i, j));
    i = j + 2;

    const semi = header.indexOf(";");
    const sizeHex = semi === -1 ? header : header.slice(0, semi);
    const size = parseInt(sizeHex, 16);
    if (size === 0) {
      sawTerminal = true;
      break;
    }
    if (!header.slice(semi + 1).startsWith("chunk-signature=")) {
      throw new Error(`malformed chunk header: ${header}`);
    }
    for (let k = 0; k < size; k++) out.push(all[i + k] as number);
    i += size + 2;
  }
  if (!sawTerminal) throw new Error("missing terminal chunk");
  return new Uint8Array(out);
}

describe("S3Driver with custom endpoint (MinIO)", () => {
  let driver: S3Driver;

  beforeEach(() => {
    driver = new S3Driver({
      bucket: "my-bucket",
      endpoint: "http://localhost:9000",
      forcePathStyle: true,
      credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
    });
  });

  it("should upload to the custom endpoint", async () => {
    mockFetch.mockResolvedValue(okResponse());

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.close();
      },
    });

    const result = await driver.upload(stream, { filename: "f.txt" });

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`http://localhost:9000/my-bucket/${result.path}`);
    expect(url).toContain("localhost:9000");
    expect(url).toContain("my-bucket");
  });

  it("should generate a URL from endpoint", async () => {
    const url = await driver.getUrl("path/to/file.txt");
    expect(url).toBe("http://localhost:9000/my-bucket/path/to/file.txt");
  });
});

describe("S3Driver (Cloudflare R2)", () => {
  let driver: S3Driver;

  beforeEach(() => {
    driver = new S3Driver({
      bucket: "my-bucket",
      endpoint: "https://accountid.r2.cloudflarestorage.com",
      region: "auto",
      credentials: { accessKeyId: "key", secretAccessKey: "secret" },
    });
  });

  it("should generate an R2 URL from endpoint", async () => {
    const url = await driver.getUrl("path/to/file.txt");
    expect(url).toBe(
      "https://accountid.r2.cloudflarestorage.com/my-bucket/path/to/file.txt",
    );
  });
});
