import { describe, it, expect, vi, beforeEach } from "vitest";
import { FilewayClient } from "@fileway/core";
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

  it("should throw a typed error when delete fails", async () => {
    mockFetch.mockResolvedValue(
      new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403, statusText: "Forbidden" }),
    );
    await expect(driver.delete("test.txt")).rejects.toMatchObject({
      code: "auth-failed",
      statusCode: 403,
      provider: "s3",
    });
  });

  it("should generate a URL", async () => {
    const url = await driver.getUrl("test.txt");
    expect(url).toBe("https://test-bucket.s3.us-east-1.amazonaws.com/test.txt");
  });

  it("should presign a GET URL with the default 1h expiry", async () => {
    const url = await driver.getPresignedUrl("test.txt");
    expect(url.startsWith("https://test-bucket.s3.us-east-1.amazonaws.com/test.txt?")).toBe(true);

    const query = new URL(url).searchParams;
    expect(query.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(query.get("X-Amz-Credential")).toMatch(/^AKID\/\d{8}\/us-east-1\/s3\/aws4_request$/);
    expect(query.get("X-Amz-Date")).toMatch(/^\d{8}T\d{6}Z$/);
    expect(query.get("X-Amz-Expires")).toBe("3600");
    expect(query.get("X-Amz-SignedHeaders")).toBe("host");
    expect(query.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sends and signs x-amz-security-token for temporary credentials", async () => {
    const stsDriver = new S3Driver({
      bucket: "test-bucket",
      region: "us-east-1",
      credentials: { accessKeyId: "ASIA", secretAccessKey: "secret", sessionToken: "session-token" },
    });
    mockFetch.mockResolvedValue(okResponse('"abc"'));

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    await stsDriver.upload(stream, { filename: "a.bin", size: 3 });
    await stsDriver.delete("a.bin");

    for (const [, opts] of mockFetch.mock.calls) {
      const headers = (opts as RequestInit).headers as Record<string, string>;
      expect(headers["x-amz-security-token"]).toBe("session-token");
      expect(headers.authorization).toMatch(/SignedHeaders=[^,]*x-amz-security-token/);
    }
  });

  it("includes the session token in presigned URLs", async () => {
    const stsDriver = new S3Driver({
      bucket: "test-bucket",
      region: "us-east-1",
      credentials: { accessKeyId: "ASIA", secretAccessKey: "secret", sessionToken: "tok/en+=" },
    });
    const url = await stsDriver.getPresignedUrl("test.txt");
    expect(new URL(url).searchParams.get("X-Amz-Security-Token")).toBe("tok/en+=");
  });

  it("should presign a URL with a custom expiry", async () => {
    const url = await driver.getPresignedUrl("test.txt", { expiresIn: 300 });
    expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe("300");
  });

  it("should reject expiries outside 1..604800 seconds", async () => {
    await expect(driver.getPresignedUrl("test.txt", { expiresIn: 0 })).rejects.toThrow(
      /expiresIn must be an integer/,
    );
    await expect(driver.getPresignedUrl("test.txt", { expiresIn: 604801 })).rejects.toThrow(
      /expiresIn must be an integer/,
    );
    await expect(driver.getPresignedUrl("test.txt", { expiresIn: 1.5 })).rejects.toThrow(
      /expiresIn must be an integer/,
    );
  });

  it("should presign a URL with a nested path without over-encoding it", async () => {
    const url = await driver.getPresignedUrl("dir/sub/file name.txt");
    expect(new URL(url).pathname).toBe("/dir/sub/file%20name.txt");
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

  it("should abort an in-flight streaming upload with AbortError", async () => {
    const controller = new AbortController();
    // Mirrors undici: the request hangs until the signal aborts, at which point
    // the body stream is cancelled.
    mockFetch.mockImplementation((_input, init) => {
      const body = init?.body as ReadableStream<Uint8Array> | undefined;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            body?.cancel().catch(() => {});
            reject(controller.signal.reason);
          },
          { once: true },
        );
      });
    });

    let sourceCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("data"));
      },
      cancel() {
        sourceCancelled = true;
      },
    });

    const upload = driver.upload(stream, {
      filename: "big.bin",
      size: 100,
      signal: controller.signal,
    });
    const errPromise = upload.catch((e) => e);
    setTimeout(() => controller.abort(), 20);
    const err = await errPromise;

    expect(err.name).toBe("AbortError");
    expect(sourceCancelled).toBe(true);
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

  it("signs each multipart request with the time it is sent", async () => {
    driver = new S3Driver({
      bucket: "test-bucket",
      region: "us-east-1",
      credentials: { accessKeyId: "AKID", secretAccessKey: "secret" },
      partSize: 5 * 1024 * 1024,
    });
    mockMultipart();

    const start = new Date("2026-01-01T00:00:00Z").getTime();
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    try {
      const chunk = new Uint8Array(5 * 1024 * 1024);
      let pulls = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          // Simulate a slow producer: 20 minutes pass before each chunk.
          vi.setSystemTime(start + ++pulls * 20 * 60 * 1000);
          if (pulls <= 2) controller.enqueue(chunk);
          else controller.close();
        },
      });

      await driver.upload(stream, { filename: "slow.bin" });

      const dates = mockFetch.mock.calls.map(
        (c) => ((c[1] as RequestInit).headers as Record<string, string>)["x-amz-date"],
      );
      // create, part 1, part 2, complete. The stream reads ahead, so exact
      // times depend on buffering; what matters is that later requests are
      // not stuck at the upload's start time.
      expect(dates).toHaveLength(4);
      expect(dates[0]).toBe("20260101T000000Z");
      for (const date of dates.slice(1)) {
        expect(date! > dates[0]!).toBe(true);
      }
      expect(dates[3]).toBe("20260101T010000Z");
    } finally {
      vi.useRealTimers();
    }
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

  it("aborts the multipart session server-side when cancelled", async () => {
    const controller = new AbortController();
    let released!: () => void;
    const gate = new Promise<void>((resolve) => (released = resolve));
    const stream = new ReadableStream<Uint8Array>({
      async start(c) {
        c.enqueue(new TextEncoder().encode("data"));
        await gate; // hold mid-upload
        c.close();
      },
    });
    mockMultipart();

    const upload = driver.upload(stream, {
      filename: "big.bin",
      signal: controller.signal,
    });
    const errPromise = upload.catch((e) => e);
    setTimeout(() => controller.abort(), 20);
    const err = await errPromise;
    released();

    expect(err.name).toBe("AbortError");

    // create + AbortMultipartUpload (DELETE), no part upload or complete.
    const methods = mockFetch.mock.calls.map((c) => (c[1] as RequestInit).method);
    expect(methods).toEqual(["POST", "DELETE"]);

    const [, deleteOpts] = mockFetch.mock.calls[1]!;
    expect(String(mockFetch.mock.calls[1]![0])).toContain("uploadId=");
    expect(deleteOpts.method).toBe("DELETE");
  });

  it("reports upload progress on multipart uploads", async () => {
    mockMultipart();

    const events: Array<{ bytes: number; total?: number; progress?: number }> = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("buffered"));
        controller.close();
      },
    });

    const result = await new FilewayClient({ driver }).upload(stream, {
      filename: "progress.bin",
      onProgress: (p) => events.push(p),
    });

    expect(result.size).toBe(8);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1]!;
    expect(last.bytes).toBe(8);
    // Unknown size → no total/progress fraction.
    expect(last.total).toBeUndefined();
    expect(last.progress).toBeUndefined();
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

  it("should presign a URL against the custom endpoint", async () => {
    const url = await driver.getPresignedUrl("path/to/file.txt", { expiresIn: 60 });
    expect(url.startsWith("http://localhost:9000/my-bucket/path/to/file.txt?")).toBe(true);

    const query = new URL(url).searchParams;
    expect(query.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(query.get("X-Amz-Credential")).toMatch(/^minioadmin\/\d{8}\/us-east-1\/s3\/aws4_request$/);
    expect(query.get("X-Amz-Expires")).toBe("60");
    expect(query.get("X-Amz-SignedHeaders")).toBe("host");
    expect(query.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
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

describe("S3Driver forcePathStyle", () => {
  const credentials = { accessKeyId: "AKID", secretAccessKey: "secret" };

  it("uses path-style AWS URLs when forcePathStyle is true", async () => {
    const driver = new S3Driver({ bucket: "b", region: "eu-west-1", forcePathStyle: true, credentials });
    expect(await driver.getUrl("a/b.txt")).toBe("https://s3.eu-west-1.amazonaws.com/b/a/b.txt");

    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await driver.delete("a/b.txt");
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://s3.eu-west-1.amazonaws.com/b/a/b.txt");
    expect((opts as RequestInit).headers as Record<string, string>).toHaveProperty("authorization");
  });

  it("uses virtual-hosted URLs on a custom endpoint when forcePathStyle is false", async () => {
    const driver = new S3Driver({
      bucket: "b",
      endpoint: "https://storage.example.com",
      forcePathStyle: false,
      credentials,
    });
    expect(await driver.getUrl("x.txt")).toBe("https://b.storage.example.com/x.txt");

    const presigned = new URL(await driver.getPresignedUrl("x.txt"));
    expect(presigned.host).toBe("b.storage.example.com");
    expect(presigned.pathname).toBe("/x.txt");
  });
});

describe("S3Driver multipart ETag handling", () => {
  it("aborts and explains when a part response has no ETag", async () => {
    const driver = new S3Driver({
      bucket: "test-bucket",
      credentials: { accessKeyId: "AKID", secretAccessKey: "secret" },
    });
    mockMultipart();
    const base = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((input: string | URL, init?: RequestInit) => {
      if (String(input).includes("partNumber=") && init?.method === "PUT") {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return base(input, init);
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });

    await expect(driver.upload(stream, { filename: "a.bin" })).rejects.toMatchObject({
      code: "provider-error",
      message: expect.stringContaining("ExposeHeaders"),
    });
    const methods = mockFetch.mock.calls.map((c) => (c[1] as RequestInit).method);
    expect(methods).toEqual(["POST", "PUT", "DELETE"]);
  });
});

describe("S3Driver error taxonomy", () => {
  let driver: S3Driver;

  beforeEach(() => {
    driver = new S3Driver({
      bucket: "test-bucket",
      region: "us-east-1",
      credentials: { accessKeyId: "AKID", secretAccessKey: "secret" },
    });
  });

  const s3XmlError = (code: string, status: number) =>
    new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>nope</Message></Error>`,
      { status },
    );

  it("classifies NoSuchKey as not-found", async () => {
    mockFetch.mockResolvedValue(s3XmlError("NoSuchKey", 404));
    await expect(driver.get("missing.txt")).rejects.toMatchObject({
      code: "not-found",
      statusCode: 404,
      provider: "s3",
    });
  });

  it("classifies NoSuchBucket as bucket-not-found", async () => {
    mockFetch.mockResolvedValue(s3XmlError("NoSuchBucket", 404));
    await expect(driver.get("file.txt")).rejects.toMatchObject({
      code: "bucket-not-found",
      statusCode: 404,
    });
  });

  it("classifies AccessDenied as auth-failed", async () => {
    mockFetch.mockResolvedValue(s3XmlError("AccessDenied", 403));
    await expect(driver.get("file.txt")).rejects.toMatchObject({ code: "auth-failed" });
  });

  it("classifies EntityTooLarge as size-exceeded", async () => {
    mockFetch.mockResolvedValue(s3XmlError("EntityTooLarge", 400));
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1]));
        c.close();
      },
    });
    await expect(
      driver.upload(stream, { filename: "big.bin", size: 1 }),
    ).rejects.toMatchObject({ code: "size-exceeded" });
  });

  it("falls back to provider-error with statusCode for unknown codes", async () => {
    mockFetch.mockResolvedValue(new Response("InternalError", { status: 500 }));
    await expect(driver.get("file.txt")).rejects.toMatchObject({
      code: "provider-error",
      statusCode: 500,
    });
  });

  it("maps a fetch rejection to network and preserves the cause", async () => {
    const cause = new TypeError("fetch failed");
    mockFetch.mockRejectedValue(cause);
    await expect(driver.get("file.txt")).rejects.toMatchObject({
      code: "network",
      provider: "s3",
      cause,
    });
  });

  it("lets an abort pass through untouched", async () => {
    const controller = new AbortController();
    controller.abort();
    mockFetch.mockRejectedValue(controller.signal.reason);
    await expect(driver.get("file.txt")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("throws config when credentials are missing", async () => {
    const noCreds = new S3Driver({ bucket: "test-bucket" });
    await expect(noCreds.get("file.txt")).rejects.toMatchObject({
      code: "config",
      provider: "s3",
    });
  });
});

describe("S3Driver stable ids and upload status", () => {
  const credentials = { accessKeyId: "AKID", secretAccessKey: "secret" };
  const body = (n: number) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(n));
        c.close();
      },
    });
  let driver: S3Driver;
  beforeEach(() => {
    driver = new S3Driver({ bucket: "b", region: "us-east-1", credentials });
  });

  it("builds the key from the id and sends the upload token as signed metadata", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 200, headers: { etag: '"e"' } }));

    const result = await driver.upload(body(3), {
      filename: "report.pdf",
      path: "docs",
      size: 3,
      id: "inv_42",
      uploadToken: "tok-1",
    });

    expect(result.path).toBe("docs/inv_42.pdf");
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(String(url)).toBe("https://b.s3.us-east-1.amazonaws.com/docs/inv_42.pdf");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-amz-meta-fileway-upload-token"]).toBe("tok-1");
    expect(headers.authorization).toMatch(/SignedHeaders=[^,]*x-amz-meta-fileway-upload-token/);
  });

  it("sends the token on the multipart create request", async () => {
    mockMultipart();
    await driver.upload(body(3), { filename: "a.bin", id: "big", uploadToken: "tok-2" });
    const [createUrl, createInit] = mockFetch.mock.calls[0]!;
    expect(String(createUrl)).toContain("/big.bin?uploads=");
    expect(((createInit as RequestInit).headers as Record<string, string>)["x-amz-meta-fileway-upload-token"]).toBe("tok-2");
  });

  it("pathFor matches the key upload uses", () => {
    expect(driver.pathFor({ filename: "x.tar.gz", path: "a/b", id: "id1" })).toBe("a/b/id1.gz");
    expect(driver.pathFor({ filename: "noext", id: "id2" })).toBe("id2");
  });

  it("head maps a stored object and returns null when missing", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: {
          "content-length": "1234",
          etag: '"abc"',
          "content-type": "application/pdf",
          "last-modified": "Mon, 26 Oct 2026 10:00:00 GMT",
          "x-amz-meta-fileway-upload-token": "tok-1",
        },
      }),
    );
    const object = await driver.head("docs/inv_42.pdf");
    expect(object).toEqual({
      id: "inv_42",
      url: "https://b.s3.us-east-1.amazonaws.com/docs/inv_42.pdf",
      path: "docs/inv_42.pdf",
      size: 1234,
      meta: { bucket: "b", etag: '"abc"' },
      uploadToken: "tok-1",
      lastModified: new Date("Mon, 26 Oct 2026 10:00:00 GMT"),
      contentType: "application/pdf",
    });
    expect((mockFetch.mock.calls[0]![1] as RequestInit).method).toBe("HEAD");

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(driver.head("docs/missing.pdf")).resolves.toBeNull();
  });

  it("head throws a typed error for other failures", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 403, statusText: "Forbidden" }));
    await expect(driver.head("x")).rejects.toMatchObject({ code: "auth-failed", statusCode: 403 });
  });

  it("isPending matches an open multipart upload by exact key", async () => {
    const listing = (...keys: string[]) =>
      new Response(
        `<ListMultipartUploadsResult>${keys.map((k) => `<Upload><Key>${k}</Key><UploadId>u</UploadId></Upload>`).join("")}</ListMultipartUploadsResult>`,
        { status: 200 },
      );
    mockFetch.mockResolvedValueOnce(listing("docs/inv_42.pdf"));
    await expect(driver.isPending("docs/inv_42.pdf")).resolves.toBe(true);
    expect(String(mockFetch.mock.calls[0]![0])).toBe(
      "https://b.s3.us-east-1.amazonaws.com/?prefix=docs%2Finv_42.pdf&uploads=",
    );

    mockFetch.mockResolvedValueOnce(listing("docs/inv_42.pdf.bak"));
    await expect(driver.isPending("docs/inv_42.pdf")).resolves.toBe(false);
  });

  it("recovers a lost PUT response without re-uploading (end to end)", async () => {
    // Simulated bucket: the PUT stores the object, then the response is lost.
    const stored = new Map<string, { size: number; token: string | undefined }>();
    let puts = 0;
    mockFetch.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const key = decodeURIComponent(url.pathname.slice(1));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (init?.method === "PUT") {
        puts++;
        // Drain the aws-chunked body like a real server would.
        await new Response(init.body as ReadableStream).arrayBuffer();
        stored.set(key, {
          size: Number(headers["x-amz-decoded-content-length"]),
          token: headers["x-amz-meta-fileway-upload-token"],
        });
        throw new TypeError("fetch failed");
      }
      if (init?.method === "HEAD") {
        const object = stored.get(key);
        if (!object) return new Response(null, { status: 404 });
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": String(object.size),
            ...(object.token ? { "x-amz-meta-fileway-upload-token": object.token } : {}),
          },
        });
      }
      return new Response(null, { status: 500 });
    });

    const client = new FilewayClient({ driver, retry: { maxRetries: 3, baseDelayMs: 1, jitter: false } });
    const result = await client.upload(body(7), { filename: "a.bin", size: 7 }); // no streamFactory

    expect(puts).toBe(1);
    expect(stored.size).toBe(1);
    expect(result.size).toBe(7);
    expect(result.path).toBe([...stored.keys()][0]);
  });
});

describe("S3Driver with retry.idleTimeoutMs", () => {
  it("cancels a hung part upload, aborts the multipart session, and retries", async () => {
    const driver = new S3Driver({ bucket: "b", credentials: { accessKeyId: "AKID", secretAccessKey: "secret" } });
    mockMultipart();
    const base = mockFetch.getMockImplementation()!;
    let partPuts = 0;
    mockFetch.mockImplementation((input: string | URL, init?: RequestInit) => {
      if (String(input).includes("partNumber=") && init?.method === "PUT" && ++partPuts === 1) {
        // First part request hangs until the attempt's signal aborts it.
        return new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      return base(input, init);
    });
    const body = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array([1, 2, 3]));
          c.close();
        },
      });
    const client = new FilewayClient({
      driver,
      retry: { maxRetries: 2, baseDelayMs: 1, jitter: false, idleTimeoutMs: 50 },
    });

    const result = await client.upload(body(), { filename: "a.bin", streamFactory: body });

    expect(result.path).toMatch(/\.bin$/);
    const methods = mockFetch.mock.calls.map((c) => (c[1] as RequestInit).method);
    // attempt 1: create, hung part, abort; recovery HEAD (500 from the mock, ignored);
    // attempt 2: create, part, complete
    expect(methods.filter((m) => m === "DELETE")).toHaveLength(1);
    expect(methods.filter((m) => m === "POST")).toHaveLength(3);
    expect(partPuts).toBe(2);
  });
});
