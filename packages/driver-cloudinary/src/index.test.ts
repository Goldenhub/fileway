import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudinaryDriver } from "./index.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

function mockResponse(data: Record<string, unknown>, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  } as Response);
}

describe("CloudinaryDriver", () => {
  let driver: CloudinaryDriver;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new CloudinaryDriver({
      cloudName: "demo",
      apiKey: "key123",
      apiSecret: "secret456",
    });
  });

  describe("upload", () => {
    it("should upload a stream and return typed metadata", async () => {
      mockFetch.mockResolvedValue(
        mockResponse({
          public_id: "abc123",
          secure_url: "https://res.cloudinary.com/demo/image/upload/abc123",
          resource_type: "image",
          bytes: 42,
          version: 1,
          format: "png",
          width: 100,
          height: 200,
        }),
      );

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data"));
          controller.close();
        },
      });

      const result = await driver.upload(stream, { filename: "test.png" });

      expect(result.id).toBe("abc123");
      expect(result.url).toBe(
        "https://res.cloudinary.com/demo/image/upload/abc123",
      );
      expect(result.size).toBe(42);
      expect(result.meta.publicId).toBe("abc123");
      expect(result.meta.resourceType).toBe("image");
      expect(result.meta.secureUrl).toBe(
        "https://res.cloudinary.com/demo/image/upload/abc123",
      );
      expect(result.meta.width).toBe(100);
      expect(result.meta.height).toBe(200);
      expect(result.meta.format).toBe("png");
    });

    it("should use path as folder in form data", async () => {
      let capturedUrl: string | undefined;
      let capturedBody: FormData | undefined;
      mockFetch.mockImplementation(
        async (url: string, init: RequestInit) => {
          capturedUrl = url;
          capturedBody = init.body as FormData;
          return mockResponse({
            public_id: "users/avatars/some-uuid",
            secure_url:
              "https://res.cloudinary.com/demo/image/upload/users/avatars/some-uuid",
            resource_type: "image",
            bytes: 0,
            version: 1,
            format: "png",
          });
        },
      );

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data"));
          controller.close();
        },
      });

      const result = await driver.upload(stream, {
        filename: "test.png",
        path: "users/avatars",
      });

      expect(result.path).toMatch(/^users\/avatars\//);
      expect(capturedBody!.get("folder")).toBe("users/avatars");
    });

    it("should include signature and timestamp in form data", async () => {
      let capturedBody: FormData | undefined;
      mockFetch.mockImplementation(
        async (url: string, init: RequestInit) => {
          capturedBody = init.body as FormData;
          return mockResponse({
            public_id: "abc123",
            secure_url: "https://res.cloudinary.com/demo/image/upload/abc123",
            resource_type: "image",
            bytes: 0,
            version: 1,
            format: "png",
          });
        },
      );

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data"));
          controller.close();
        },
      });

      await driver.upload(stream, { filename: "test.png" });

      expect(capturedBody!.get("api_key")).toBe("key123");
      expect(capturedBody!.get("signature")).toBeDefined();
      expect(capturedBody!.get("timestamp")).toBeDefined();
    });

    it("should throw on non-ok response", async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ error: { message: "invalid" } }, 400),
      );

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data"));
          controller.close();
        },
      });

      await expect(
        driver.upload(stream, { filename: "test.png" }),
      ).rejects.toThrow("Cloudinary HTTP Upload Failed (400)");
    });
  });

  describe("delete", () => {
    it("should delete an asset by public_id", async () => {
      mockFetch.mockResolvedValue(mockResponse({ result: "ok" }));

      const deleted = await driver.delete("abc123");

      expect(deleted).toBe(true);
    });

    it("should return false on delete failure", async () => {
      mockFetch.mockResolvedValue(mockResponse({ result: "not found" }));

      const deleted = await driver.delete("nonexistent_id");
      expect(deleted).toBe(false);
    });

    it("should return false when fetch fails", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const deleted = await driver.delete("abc123");
      expect(deleted).toBe(false);
    });
  });

  describe("getUrl", () => {
    it("should construct a Cloudinary URL from public_id", async () => {
      const url = await driver.getUrl("abc123");
      expect(url).toBe(
        "https://res.cloudinary.com/demo/image/upload/abc123",
      );
    });
  });
});
