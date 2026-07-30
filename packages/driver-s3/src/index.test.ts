import { describe, it, expect, vi, beforeEach } from "vitest";
import { S3Driver } from "./index.js";

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({
    send: mockSend,
  })),
  PutObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}));

vi.mock("@smithy/fetch-http-handler", () => ({
  FetchHttpHandler: vi.fn(),
}));

describe("S3Driver (AWS S3)", () => {
  let driver: S3Driver;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new S3Driver({ bucket: "test-bucket", region: "us-east-1" });
  });

  it("should upload a stream via PutObjectCommand", async () => {
    mockSend.mockResolvedValue({ ETag: '"abc123"' });

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
  });

  it("should delete an object", async () => {
    mockSend.mockResolvedValue({});

    const result = await driver.delete("test.txt");
    expect(result).toBe(true);
  });

  it("should return false on delete failure", async () => {
    mockSend.mockRejectedValue(new Error("not found"));

    const result = await driver.delete("missing.txt");
    expect(result).toBe(false);
  });

  it("should generate a URL", async () => {
    const url = await driver.getUrl("test.txt");
    expect(url).toBe("https://test-bucket.s3.us-east-1.amazonaws.com/test.txt");
  });
});

describe("S3Driver (Cloudflare R2)", () => {
  let driver: S3Driver;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new S3Driver({
      bucket: "my-bucket",
      endpoint: "https://accountid.r2.cloudflarestorage.com",
      region: "auto",
    });
  });

  it("should generate an R2 URL from endpoint", async () => {
    const url = await driver.getUrl("path/to/file.txt");
    expect(url).toBe(
      "https://accountid.r2.cloudflarestorage.com/my-bucket/path/to/file.txt",
    );
  });
});
