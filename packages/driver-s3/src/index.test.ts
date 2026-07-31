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

function mockMultipart(opts?: { completeEtag?: string }) {
  const completeEtag = opts?.completeEtag ?? '"final-etag"';
  mockFetch.mockImplementation((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("?uploads=")) {
      return Promise.resolve(
        new Response(
          "<InitiateMultipartUploadResult><UploadId>upload-id-123</UploadId></InitiateMultipartUploadResult>",
          { status: 200 },
        ),
      );
    }
    if (url.includes("uploadId=")) {
      if (method === "PUT") {
        return Promise.resolve(new Response(null, { status: 200, headers: { etag: '"part-etag"' } }));
      }
      if (method === "POST") {
        return Promise.resolve(
          new Response(
            `<CompleteMultipartUploadResult><ETag>${completeEtag}</ETag></CompleteMultipartUploadResult>`,
            { status: 200 },
          ),
        );
      }
      if (method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
    }
    if (method === "PUT") {
      // Plain single PUT (empty-stream fallback) or other PUTs.
      return Promise.resolve(new Response(null, { status: 200, headers: { etag: '"empty-etag"' } }));
    }
    return Promise.resolve(new Response(null, { status: 500, statusText: "unexpected call" }));
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
    mockMultipart({ completeEtag: '"abc123"' });

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
    expect(result.size).toBe(4);

    // Unknown size → multipart: create → part → complete.
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const [createUrl, createOpts] = mockFetch.mock.calls[0]!;
    expect(String(createUrl)).toContain("?uploads=");
    expect(createOpts.method).toBe("POST");
    expect(createOpts.headers["authorization"]).toBeDefined();
    expect(createOpts.headers["x-amz-content-sha256"]).toBeDefined();
    expect(createOpts.headers["x-amz-date"]).toBeDefined();

    const [, partOpts] = mockFetch.mock.calls[1]!;
    expect(partOpts.method).toBe("PUT");
    expect(new TextDecoder().decode(partOpts.body as Uint8Array)).toBe("data");

    const [, completeOpts] = mockFetch.mock.calls[2]!;
    expect(completeOpts.method).toBe("POST");
    expect(new TextDecoder().decode(completeOpts.body as Uint8Array)).toContain(
      "<CompleteMultipartUpload>",
    );
  });

  it("should upload with metadata", async () => {
    mockMultipart();

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

    // Object metadata lives on the CreateMultipartUpload request, not the parts.
    const [createUrl, createOpts] = mockFetch.mock.calls[0]!;
    expect(String(createUrl)).toContain("?uploads=");
    expect(createOpts.headers["x-amz-meta-userid"]).toBe("42");
    expect(createOpts.headers["x-amz-meta-source"]).toBe("mobile");

    const [, partOpts] = mockFetch.mock.calls[1]!;
    expect(partOpts.headers["x-amz-meta-userid"]).toBeUndefined();
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

  it("should stream an object back with a GET request", async () => {
    const bytes = new TextEncoder().encode("file-content");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    mockFetch.mockResolvedValue(new Response(body, { status: 200 }));

    const stream = await driver.get("uploads/hello.txt");

    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toContain("uploads/hello.txt");
    expect(opts.method).toBe("GET");
    expect(new Uint8Array(await new Response(stream).arrayBuffer())).toEqual(bytes);
  });

  it("should throw on a non-ok GET", async () => {
    mockFetch.mockResolvedValue(new Response("NoSuchKey", { status: 404 }));

    await expect(driver.get("missing.txt")).rejects.toThrow(/S3 get failed: 404/);
  });

  it("should throw when the GET response has no body", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(driver.get("empty.txt")).rejects.toThrow(/no response body/);
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

  it("should use multipart when size is unknown", async () => {
    mockMultipart();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("buffered"));
        controller.close();
      },
    });

    const result = await driver.upload(stream, { filename: "b.txt" });

    expect(result.size).toBe(8);
    const [createUrl] = mockFetch.mock.calls[0]!;
    expect(String(createUrl)).toContain("?uploads=");

    const [, partOpts] = mockFetch.mock.calls[1]!;
    expect(partOpts.method).toBe("PUT");
    expect(new TextDecoder().decode(partOpts.body as Uint8Array)).toBe("buffered");
  });
});

describe("S3Driver multipart upload", () => {
  let driver: S3Driver;

  beforeEach(() => {
    driver = new S3Driver({
      bucket: "test-bucket",
      region: "us-east-1",
      credentials: { accessKeyId: "AKID", secretAccessKey: "secret" },
    });
  });

  it("splits a payload larger than partSize into signed parts", async () => {
    driver = new S3Driver({
      bucket: "test-bucket",
      region: "us-east-1",
      credentials: { accessKeyId: "AKID", secretAccessKey: "secret" },
      partSize: 5 * 1024 * 1024,
      forceMultipart: true,
    });
    mockMultipart();

    const payload = new Uint8Array(6 * 1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      },
    });

    const result = await driver.upload(stream, {
      filename: "big.bin",
      size: payload.byteLength,
    });

    expect(result.size).toBe(payload.byteLength);
    expect(mockFetch).toHaveBeenCalledTimes(4); // create, part 1, part 2, complete

    const [, part1Opts] = mockFetch.mock.calls[1]!;
    expect((part1Opts.body as Uint8Array).byteLength).toBe(5 * 1024 * 1024);
    expect(String(mockFetch.mock.calls[1]![0])).toContain("partNumber=1&uploadId=upload-id-123");

    const [, part2Opts] = mockFetch.mock.calls[2]!;
    expect((part2Opts.body as Uint8Array).byteLength).toBe(1024 * 1024);

    const [, completeOpts] = mockFetch.mock.calls[3]!;
    const xml = new TextDecoder().decode(completeOpts.body as Uint8Array);
    expect(xml).toContain('<Part><PartNumber>1</PartNumber><ETag>"part-etag"</ETag></Part>');
    expect(xml).toContain('<Part><PartNumber>2</PartNumber><ETag>"part-etag"</ETag></Part>');
  });

  it("routes >5 GiB uploads to multipart and aborts on size mismatch", async () => {
    mockMultipart();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    await expect(
      driver.upload(stream, { filename: "huge.bin", size: 6 * 1024 ** 3 }),
    ).rejects.toThrow(/expected 6442450944/);

    // create + abort, no complete
    const methods = mockFetch.mock.calls.map((c) => (c[1] as RequestInit).method);
    expect(methods).toEqual(["POST", "DELETE"]);
  });

  it("aborts multipart when the declared size is wrong", async () => {
    driver = new S3Driver({
      bucket: "test-bucket",
      region: "us-east-1",
      credentials: { accessKeyId: "AKID", secretAccessKey: "secret" },
      partSize: 5 * 1024 * 1024,
      forceMultipart: true,
    });
    mockMultipart();

    const payload = new Uint8Array(6 * 1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      },
    });

    await expect(
      driver.upload(stream, { filename: "wrong.bin", size: 100 }),
    ).rejects.toThrow(/expected 100/);

    const methods = mockFetch.mock.calls.map((c) => (c[1] as RequestInit).method);
    expect(methods).toEqual(["POST", "PUT", "DELETE"]);
  });

  it("falls back to a single empty PUT for an empty stream", async () => {
    mockMultipart();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    const result = await driver.upload(stream, { filename: "empty.bin" });
    expect(result.size).toBe(0);

    const methods = mockFetch.mock.calls.map((c) => (c[1] as RequestInit).method);
    expect(methods).toEqual(["POST", "DELETE", "PUT"]);

    const [, putOpts] = mockFetch.mock.calls[2]!;
    expect((putOpts.body as Uint8Array).byteLength).toBe(0);
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
    mockMultipart();

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.close();
      },
    });

    const result = await driver.upload(stream, { filename: "f.txt" });

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`http://localhost:9000/my-bucket/${result.path}?uploads=`);
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
