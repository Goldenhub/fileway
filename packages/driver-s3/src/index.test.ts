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
