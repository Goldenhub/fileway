import { describe, it, expect, vi, beforeEach } from "vitest";
import { FilewayClient } from "@fileway/core";
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

function mockSearch(
  resource?: { resource_type: string; version?: number; secure_url?: string },
  deletedMap?: Record<string, string>,
) {
  mockFetch.mockImplementation(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/resources/search")) {
      return mockResponse({
        total_count: resource ? 1 : 0,
        resources: resource
          ? [{ public_id: "x", ...resource }]
          : [],
      });
    }
    if (init?.method === "DELETE") {
      return mockResponse({ deleted: deletedMap ?? { abc123: "deleted" } });
    }
    return mockResponse({});
  });
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

    it("should forward an abort signal to the upload fetch", async () => {
      let capturedInit: RequestInit | undefined;
      mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
        capturedInit = init;
        return mockResponse({
          public_id: "abc123",
          secure_url: "https://res.cloudinary.com/demo/image/upload/abc123",
          resource_type: "image",
          bytes: 0,
          version: 1,
          format: "png",
        });
      });

      const controller = new AbortController();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data"));
          controller.close();
        },
      });

      await driver.upload(stream, {
        filename: "test.png",
        signal: controller.signal,
      });

      expect(capturedInit!.signal).toBe(controller.signal);
    });

    it("should reject with AbortError when fetch aborts", async () => {
      const controller = new AbortController();
      mockFetch.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(controller.signal.reason),
              { once: true },
            );
          }),
      );

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data"));
          controller.close();
        },
      });

      const upload = driver.upload(stream, {
        filename: "test.png",
        signal: controller.signal,
      });
      const errPromise = upload.catch((e) => e);
      setTimeout(() => controller.abort(), 20);
      const err = await errPromise;

      expect(err.name).toBe("AbortError");
    });

    it("should report progress while buffering the stream", async () => {
      mockFetch.mockResolvedValue(
        mockResponse({
          public_id: "abc123",
          secure_url: "https://res.cloudinary.com/demo/image/upload/abc123",
          resource_type: "image",
          bytes: 4,
          version: 1,
          format: "png",
        }),
      );

      const events: Array<{ bytes: number; total?: number; progress?: number }> = [];
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data"));
          controller.close();
        },
      });

      await new FilewayClient({ driver }).upload(stream, {
        filename: "test.png",
        size: 4,
        onProgress: (p) => events.push(p),
      });

      expect(events.length).toBeGreaterThanOrEqual(1);
      const last = events[events.length - 1]!;
      expect(last.bytes).toBe(4);
      expect(last.total).toBe(4);
      expect(last.progress).toBe(1);
    });
  });

  describe("delete", () => {
    it("should delete an asset by public_id", async () => {
      mockSearch({ resource_type: "image" }, { abc123: "deleted" });

      const deleted = await driver.delete("abc123");

      expect(deleted).toBe(true);
    });

    it("should delete a foreign raw asset via the Admin API with the resolved type", async () => {
      mockSearch({ resource_type: "raw" }, { "assets/sheet.csv": "deleted" });

      const deleted = await driver.delete("assets/sheet.csv");

      expect(deleted).toBe(true);
      const search = mockFetch.mock.calls.find(([url]) => String(url).includes("/resources/search"));
      expect(search).toBeDefined();
      const destroy = mockFetch.mock.calls.find(([url]) => String(url).includes("/resources/raw/upload"));
      expect(destroy).toBeDefined();
      expect(String(destroy![0])).toContain("public_ids[]=assets%2Fsheet.csv");
      expect((destroy![1] as RequestInit).method).toBe("DELETE");
      expect((destroy![1] as RequestInit).headers as Record<string, string>).toEqual({
        authorization: `Basic ${btoa("key123:secret456")}`,
      });
    });

    it("should use an explicit resourceType hint and skip the Admin lookup", async () => {
      mockSearch({ resource_type: "image" }, { clip1: "deleted" });

      const deleted = await driver.delete("clip1", { resourceType: "video" });

      expect(deleted).toBe(true);
      expect(mockFetch.mock.calls.some(([url]) => String(url).includes("/resources/search"))).toBe(false);
      expect(
        mockFetch.mock.calls.some(([url]) => String(url).includes("/resources/video/upload")),
      ).toBe(true);
    });

    it("should return false without a destroy call when the asset is unknown", async () => {
      mockSearch(undefined);

      const deleted = await driver.delete("nonexistent_id");

      expect(deleted).toBe(false);
      expect(
        mockFetch.mock.calls.some(([, init]) => (init as RequestInit)?.method === "DELETE"),
      ).toBe(false);
    });

    it("should return false on delete failure", async () => {
      mockSearch({ resource_type: "image" }, { nonexistent_id: "not_found" });

      const deleted = await driver.delete("nonexistent_id");
      expect(deleted).toBe(false);
    });

    it("should return false when fetch fails", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const deleted = await driver.delete("abc123");
      expect(deleted).toBe(false);
    });

    it("should purge the cache after a confirmed delete", async () => {
      // Upload seeds the cache; deleting must evict it.
      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        if (String(url).includes("/auto/upload")) {
          return mockResponse({
            public_id: "abc123",
            secure_url: "https://res.cloudinary.com/demo/image/upload/abc123",
            resource_type: "image",
            bytes: 0,
            version: 1,
            format: "png",
          });
        }
        if (String(url).includes("/resources/search")) {
          return mockResponse({ total_count: 0, resources: [] });
        }
        if (init?.method === "DELETE") {
          return mockResponse({ deleted: { abc123: "deleted" } });
        }
        return mockResponse({});
      });
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data"));
          controller.close();
        },
      });
      await driver.upload(stream, { filename: "test.png" });

      expect(await driver.delete("abc123")).toBe(true);

      // Cache is gone → the next getUrl falls back to the Admin lookup.
      mockFetch.mockClear();
      mockFetch.mockImplementation(async (url: string) => {
        if (String(url).includes("/resources/search")) {
          return mockResponse({ total_count: 0, resources: [] });
        }
        return mockResponse({});
      });
      await driver.getUrl("abc123");
      expect(
        mockFetch.mock.calls.some(([url]) => String(url).includes("/resources/search")),
      ).toBe(true);
    });
  });

  describe("getUrl", () => {
    it("should construct a Cloudinary URL from public_id", async () => {
      mockSearch(undefined);

      const url = await driver.getUrl("abc123");
      expect(url).toBe(
        "https://res.cloudinary.com/demo/image/upload/abc123",
      );
    });

    it("should use the Admin API for a foreign video asset", async () => {
      mockSearch({
        resource_type: "video",
        version: 1761488857,
        secure_url: "https://res.cloudinary.com/demo/video/upload/v1761488857/clip1.mp4",
      });

      const url = await driver.getUrl("clip1");

      expect(url).toBe(
        "https://res.cloudinary.com/demo/video/upload/v1761488857/clip1.mp4",
      );
      const search = mockFetch.mock.calls.find(([u]) => String(u).includes("/resources/search"));
      expect(search).toBeDefined();
      const init = search![1] as RequestInit;
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).authorization).toBe(
        `Basic ${btoa("key123:secret456")}`,
      );
      expect(JSON.parse(init.body as string)).toEqual({
        expression: "public_id:clip1",
        max_results: 1,
      });
    });

    it("should build a versioned URL when the Admin result has no secure_url", async () => {
      mockSearch({ resource_type: "video", version: 42 });

      const url = await driver.getUrl("clip1");
      expect(url).toBe(
        "https://res.cloudinary.com/demo/video/upload/v42/clip1",
      );
    });

    it("should use an explicit hint with no network calls", async () => {
      mockFetch.mockImplementation(async () => {
        throw new Error("should not fetch");
      });

      const url = await driver.getUrl("clip1", { resourceType: "raw", version: 7 });
      expect(url).toBe("https://res.cloudinary.com/demo/raw/upload/v7/clip1");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should reuse the upload cache without an Admin lookup", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (String(url).includes("/auto/upload")) {
          return mockResponse({
            public_id: "abc123",
            secure_url: "https://res.cloudinary.com/demo/image/upload/v1/abc123",
            resource_type: "image",
            bytes: 0,
            version: 1,
            format: "png",
          });
        }
        throw new Error("should not fetch");
      });
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data"));
          controller.close();
        },
      });
      await driver.upload(stream, { filename: "test.png" });

      mockFetch.mockClear();
      const url = await driver.getUrl("abc123");
      expect(url).toBe("https://res.cloudinary.com/demo/image/upload/v1/abc123");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("get", () => {
    it("should return the CDN response body as a stream", async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("image-bytes"));
          controller.close();
        },
      });
      mockFetch.mockResolvedValue({ ok: true, status: 200, body } as Response);

      const stream = await driver.get("abc123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://res.cloudinary.com/demo/image/upload/abc123",
        {},
      );
      expect(stream).toBe(body);
    });

    it("should throw on a non-ok response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response);

      await expect(driver.get("missing")).rejects.toThrow(
        "Cloudinary get failed: 404 Not Found",
      );
    });

    it("should throw when the response has no body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
      } as Response);

      await expect(driver.get("abc123")).rejects.toThrow(
        /no response body/,
      );
    });
  });

  describe("getPresignedUrl", () => {
    it("should match the Cloudinary documented signature vector", async () => {
      mockFetch.mockImplementation(async () => {
        throw new Error("should not fetch");
      });

      // to_sign = "v123/sample" + "secret456" → base64url(sha1)[:8] = BUKMRPuV
      const url = await driver.getPresignedUrl("sample", {
        resourceType: "image",
        version: 123,
      });
      expect(url.startsWith(
        "https://res.cloudinary.com/demo/image/upload/s--BUKMRPuV--/v123/sample?expires_at=",
      )).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should default to a 3600s expiry and upload delivery type", async () => {
      mockSearch({ resource_type: "image", version: 1 });

      const url = await driver.getPresignedUrl("abc123");

      const parsed = new URL(url);
      expect(parsed.pathname).toMatch(/^\/demo\/image\/upload\/s--[A-Za-z0-9_-]{8}--\/v1\/abc123$/);
      const expiresAt = Number(parsed.searchParams.get("expires_at"));
      expect(Number.isInteger(expiresAt)).toBe(true);
      expect(Math.abs(expiresAt - (Math.floor(Date.now() / 1000) + 3600))).toBeLessThan(5);
    });

    it("should honor a custom expiresIn and delivery type", async () => {
      mockFetch.mockImplementation(async () => {
        throw new Error("should not fetch");
      });

      const url = await driver.getPresignedUrl("clip1", {
        resourceType: "video",
        version: 42,
        expiresIn: 300,
        deliveryType: "authenticated",
      });

      const parsed = new URL(url);
      expect(parsed.pathname.startsWith("/demo/video/authenticated/s--")).toBe(true);
      const expiresAt = Number(parsed.searchParams.get("expires_at"));
      expect(Math.abs(expiresAt - (Math.floor(Date.now() / 1000) + 300))).toBeLessThan(5);
    });

    it("should sign without a version when the version is unknown", async () => {
      mockSearch({ resource_type: "image" });

      const url = await driver.getPresignedUrl("abc123");

      expect(new URL(url).pathname).toMatch(/^\/demo\/image\/upload\/s--[A-Za-z0-9_-]{8}--\/abc123$/);
    });

    it("should reject non-positive or fractional expiries", async () => {
      await expect(driver.getPresignedUrl("abc123", { expiresIn: 0 })).rejects.toThrow(
        /expiresIn must be a positive integer/,
      );
      await expect(driver.getPresignedUrl("abc123", { expiresIn: 1.5 })).rejects.toThrow(
        /expiresIn must be a positive integer/,
      );
    });
  });

  describe("error taxonomy", () => {
    const uploadStream = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode("data"));
          c.close();
        },
      });

    it("classifies an upload 401 as auth-failed", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      } as Response);
      await expect(driver.upload(uploadStream(), { filename: "a.png" })).rejects.toMatchObject({
        code: "auth-failed",
        statusCode: 401,
        provider: "cloudinary",
      });
    });

    it("classifies an upload 404 as bucket-not-found", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response);
      await expect(driver.upload(uploadStream(), { filename: "a.png" })).rejects.toMatchObject({
        code: "bucket-not-found",
        statusCode: 404,
      });
    });

    it("classifies a get 404 as not-found", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response);
      await expect(driver.get("missing")).rejects.toMatchObject({
        code: "not-found",
        statusCode: 404,
      });
    });

    it("classifies a 5xx as provider-error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as Response);
      await expect(driver.get("abc123")).rejects.toMatchObject({
        code: "provider-error",
        statusCode: 500,
      });
    });

    it("maps a fetch rejection to network and preserves the cause", async () => {
      const cause = new TypeError("fetch failed");
      mockFetch.mockRejectedValue(cause);
      await expect(driver.get("abc123")).rejects.toMatchObject({
        code: "network",
        provider: "cloudinary",
        cause,
      });
    });

    it("lets an abort pass through untouched", async () => {
      const controller = new AbortController();
      controller.abort();
      mockFetch.mockRejectedValue(controller.signal.reason);
      await expect(driver.get("abc123")).rejects.toMatchObject({ name: "AbortError" });
    });
  });
});
