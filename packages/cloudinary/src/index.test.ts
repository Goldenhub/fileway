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

    it("should upload large streams in chunks with Content-Range headers", async () => {
      const MiB = 1024 * 1024;
      const chunked = new CloudinaryDriver({
        cloudName: "demo",
        apiKey: "key123",
        apiSecret: "secret456",
        chunkSize: 5 * MiB,
      });
      const calls: Array<{ headers: Record<string, string>; size: number }> = [];
      mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
        const file = (init.body as FormData).get("file") as Blob;
        calls.push({ headers: (init.headers ?? {}) as Record<string, string>, size: file.size });
        return mockResponse({
          public_id: "big",
          secure_url: "https://res.cloudinary.com/demo/video/upload/big",
          resource_type: "video",
          bytes: 12 * MiB,
          version: 1,
          format: "mp4",
          done: calls.length === 3,
        });
      });

      // 12 MiB delivered in 1 MiB pieces: never more than ~one chunk buffered.
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent === 12) return controller.close();
          sent++;
          controller.enqueue(new Uint8Array(MiB));
        },
      });

      const result = await chunked.upload(stream, { filename: "big.mp4" });

      expect(result.size).toBe(12 * MiB);
      expect(calls.map((c) => c.size)).toEqual([5 * MiB, 5 * MiB, 2 * MiB]);
      const ids = new Set(calls.map((c) => c.headers["x-unique-upload-id"]));
      expect(ids.size).toBe(1);
      expect(calls.map((c) => c.headers["content-range"])).toEqual([
        `bytes 0-${5 * MiB - 1}/-1`,
        `bytes ${5 * MiB}-${10 * MiB - 1}/-1`,
        `bytes ${10 * MiB}-${12 * MiB - 1}/${12 * MiB}`,
      ]);
    });

    it("should use the declared size in Content-Range when known", async () => {
      const MiB = 1024 * 1024;
      const chunked = new CloudinaryDriver({ cloudName: "demo", apiKey: "k", apiSecret: "s", chunkSize: 5 * MiB });
      const ranges: string[] = [];
      mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
        ranges.push(((init.headers ?? {}) as Record<string, string>)["content-range"] ?? "");
        return mockResponse({ public_id: "big", secure_url: "", resource_type: "raw", bytes: 6 * MiB, version: 1, format: "" });
      });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(6 * MiB));
          controller.close();
        },
      });

      await chunked.upload(stream, { filename: "big.bin", size: 6 * MiB });

      expect(ranges).toEqual([`bytes 0-${5 * MiB - 1}/${6 * MiB}`, `bytes ${5 * MiB}-${6 * MiB - 1}/${6 * MiB}`]);
    });

    it("should stop with size-exceeded as soon as maxSizeBytes is passed", async () => {
      const limited = new CloudinaryDriver({ cloudName: "demo", apiKey: "k", apiSecret: "s", maxSizeBytes: 3 });
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(2));
        },
        cancel() {
          cancelled = true;
        },
      });

      await expect(limited.upload(stream, { filename: "a.bin" })).rejects.toMatchObject({
        code: "size-exceeded",
        provider: "cloudinary",
      });
      expect(cancelled).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("asset lookup", () => {
    it("should quote and escape public IDs in the search expression", async () => {
      mockSearch(undefined);

      await driver.getUrl('folder/odd "name" \\ x');

      const search = mockFetch.mock.calls.find(([u]) => String(u).includes("/resources/search"))!;
      expect(JSON.parse((search[1] as RequestInit).body as string).expression).toBe(
        'public_id="folder/odd \\"name\\" \\\\ x"',
      );
    });

    it("should evict the least recently used entry when the cache is full", async () => {
      const small = new CloudinaryDriver({ cloudName: "demo", apiKey: "k", apiSecret: "s", cacheSize: 2 });
      mockFetch.mockImplementation(async (url: string) => {
        if (String(url).includes("/resources/search")) {
          return mockResponse({ resources: [{ resource_type: "raw", version: 1 }] });
        }
        return mockResponse({});
      });

      await small.getUrl("a");
      await small.getUrl("b");
      await small.getUrl("a"); // cache hit, refreshes "a"
      await small.getUrl("c"); // evicts "b"
      mockFetch.mockClear();

      await small.getUrl("a");
      await small.getUrl("c");
      expect(mockFetch).not.toHaveBeenCalled();
      await small.getUrl("b");
      expect(mockFetch).toHaveBeenCalledTimes(1);
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

    it("should throw a network error when fetch fails", async () => {
      mockFetch.mockRejectedValue(new TypeError("fetch failed"));

      await expect(driver.delete("abc123")).rejects.toMatchObject({ code: "network" });
    });

    it("should throw when the Admin API rejects the delete", async () => {
      mockFetch.mockImplementation(async () => mockResponse({ error: { message: "bad key" } }, 401));

      await expect(driver.delete("abc123", { resourceType: "image" })).rejects.toMatchObject({
        code: "auth-failed",
        statusCode: 401,
      });
    });

    it("should throw when the Admin lookup fails instead of reporting not found", async () => {
      mockFetch.mockImplementation(async () => mockResponse({}, 500));

      await expect(driver.delete("abc123")).rejects.toMatchObject({
        code: "provider-error",
        statusCode: 500,
      });
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
        expression: 'public_id="clip1"',
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

      const stream = await driver.get("abc123", { resourceType: "image" });

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

      await expect(driver.get("missing", { resourceType: "image" })).rejects.toThrow(
        "Cloudinary get failed: 404 Not Found",
      );
    });

    it("should throw when the response has no body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
      } as Response);

      await expect(driver.get("abc123", { resourceType: "image" })).rejects.toThrow(
        /no response body/,
      );
    });
  });

  describe("getPresignedUrl", () => {
    it("should return a signed private download URL that expires", async () => {
      mockFetch.mockImplementation(async () => {
        throw new Error("should not fetch");
      });
      vi.useFakeTimers({ toFake: ["Date"], now: 1_700_000_000_000 });
      try {
        const url = await driver.getPresignedUrl("sample", {
          resourceType: "image",
          format: "png",
          expiresIn: 300,
        });

        const parsed = new URL(url);
        expect(`${parsed.origin}${parsed.pathname}`).toBe("https://api.cloudinary.com/v1_1/demo/image/download");
        const q = parsed.searchParams;
        expect(q.get("public_id")).toBe("sample");
        expect(q.get("format")).toBe("png");
        expect(q.get("type")).toBe("upload");
        expect(q.get("timestamp")).toBe("1700000000");
        expect(q.get("expires_at")).toBe("1700000300");
        expect(q.get("api_key")).toBe("key123");

        // sha1("expires_at=1700000300&format=png&public_id=sample&timestamp=1700000000&type=upload" + secret)
        const toSign = "expires_at=1700000300&format=png&public_id=sample&timestamp=1700000000&type=upload" + "secret456";
        const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(toSign));
        const expected = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
        expect(q.get("signature")).toBe(expected);
        expect(mockFetch).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("should default to a 3600s expiry and use the cached format", async () => {
      mockSearch({ resource_type: "image", version: 1 });
      mockFetch.mockImplementationOnce(async () =>
        mockResponse({ resources: [{ resource_type: "video", version: 1, format: "mp4" }] }),
      );

      const url = await driver.getPresignedUrl("clip1");

      const parsed = new URL(url);
      expect(parsed.pathname).toBe("/v1_1/demo/video/download");
      expect(parsed.searchParams.get("format")).toBe("mp4");
      const expiresAt = Number(parsed.searchParams.get("expires_at"));
      expect(Math.abs(expiresAt - (Math.floor(Date.now() / 1000) + 3600))).toBeLessThan(5);
    });

    it("should pass the delivery type through", async () => {
      const url = await driver.getPresignedUrl("doc1", { resourceType: "raw", deliveryType: "authenticated" });
      const parsed = new URL(url);
      expect(parsed.pathname).toBe("/v1_1/demo/raw/download");
      expect(parsed.searchParams.get("type")).toBe("authenticated");
      expect(parsed.searchParams.has("format")).toBe(false);
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

  describe("getSignedUrl", () => {
    it("should match the Cloudinary documented signature vector", async () => {
      mockFetch.mockImplementation(async () => {
        throw new Error("should not fetch");
      });

      // to_sign = "v123/sample" + "secret456" → base64url(sha1)[:8] = BUKMRPuV
      const url = await driver.getSignedUrl("sample", {
        resourceType: "image",
        version: 123,
      });
      expect(url).toBe("https://res.cloudinary.com/demo/image/upload/s--BUKMRPuV--/v123/sample");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should honor the delivery type and sign without an unknown version", async () => {
      const url = await driver.getSignedUrl("clip1", { resourceType: "video", deliveryType: "authenticated" });
      expect(new URL(url).pathname).toMatch(/^\/demo\/video\/authenticated\/s--[A-Za-z0-9_-]{8}--\/clip1$/);
    });
  });

  describe("delivery types", () => {
    const smallStream = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode("data"));
          c.close();
        },
      });
    const sha1Hex = async (s: string) =>
      Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s))), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    const deliverySig = async (path: string) => {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(path + "secret456")));
      let binary = "";
      for (const b of digest) binary += String.fromCharCode(b);
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 8);
    };
    const uploadResponse = (type?: string) =>
      mockResponse({
        public_id: "abc",
        secure_url: `https://res.cloudinary.com/demo/image/${type ?? "upload"}/v1/abc.png`,
        resource_type: "image",
        ...(type ? { type } : {}),
        bytes: 4,
        version: 1,
        format: "png",
      });

    it("does not send a type for default (public) uploads", async () => {
      let body: FormData | undefined;
      mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
        body = init.body as FormData;
        return uploadResponse();
      });

      const result = await driver.upload(smallStream(), { filename: "a.png" });

      expect(body!.has("type")).toBe(false);
      expect(result.meta.deliveryType).toBe("upload");
    });

    it("uploads with the driver's deliveryType and signs it", async () => {
      const authed = new CloudinaryDriver({
        cloudName: "demo",
        apiKey: "key123",
        apiSecret: "secret456",
        deliveryType: "authenticated",
      });
      let body: FormData | undefined;
      mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
        body = init.body as FormData;
        return uploadResponse("authenticated");
      });

      const result = await authed.upload(smallStream(), { filename: "a.png" });

      expect(body!.get("type")).toBe("authenticated");
      const ts = body!.get("timestamp") as string;
      const publicId = body!.get("public_id") as string;
      expect(body!.get("signature")).toBe(
        await sha1Hex(`overwrite=true&public_id=${publicId}&timestamp=${ts}&type=authenticated` + "secret456"),
      );
      expect(result.meta.deliveryType).toBe("authenticated");
    });

    it("accepts a per-upload deliveryType through FilewayClient", async () => {
      let body: FormData | undefined;
      mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
        body = init.body as FormData;
        return uploadResponse("private");
      });

      const result = await new FilewayClient({ driver }).upload(smallStream(), {
        filename: "a.png",
        deliveryType: "private",
      });

      expect(body!.get("type")).toBe("private");
      expect(result.meta.deliveryType).toBe("private");
    });

    it("returns a signed URL from getUrl for an authenticated upload, with no lookup", async () => {
      mockFetch.mockImplementation(async () => uploadResponse("authenticated"));
      await driver.upload(smallStream(), { filename: "a.png", deliveryType: "authenticated" });
      mockFetch.mockClear();

      const url = await driver.getUrl("abc");

      expect(url).toBe(
        `https://res.cloudinary.com/demo/image/authenticated/s--${await deliverySig("v1/abc.png")}--/v1/abc.png`,
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("signs private assets found via the Admin API", async () => {
      mockFetch.mockImplementation(async () =>
        mockResponse({ resources: [{ resource_type: "video", type: "private", version: 9, format: "mp4" }] }),
      );

      const url = await driver.getUrl("clip");

      expect(url).toBe(`https://res.cloudinary.com/demo/video/private/s--${await deliverySig("v9/clip.mp4")}--/v9/clip.mp4`);
    });

    it("filters the lookup by an explicit deliveryType", async () => {
      mockSearch({ resource_type: "image" });

      await driver.getUrl("abc", { deliveryType: "private" });

      const search = mockFetch.mock.calls.find(([u]) => String(u).includes("/resources/search"))!;
      expect(JSON.parse((search[1] as RequestInit).body as string).expression).toBe('public_id="abc" AND type=private');
    });

    it("deletes through the asset's delivery type path", async () => {
      mockFetch.mockImplementation(async () => mockResponse({ deleted: { abc: "deleted" } }));

      expect(await driver.delete("abc", { resourceType: "raw", deliveryType: "authenticated" })).toBe(true);

      expect(String(mockFetch.mock.calls[0]![0])).toContain("/resources/raw/authenticated?public_ids[]=abc");
    });

    it("uses the cached delivery type for presigned download URLs", async () => {
      mockFetch.mockImplementation(async () => uploadResponse("private"));
      await driver.upload(smallStream(), { filename: "a.png", deliveryType: "private" });
      mockFetch.mockClear();

      const url = new URL(await driver.getPresignedUrl("abc"));

      expect(url.searchParams.get("type")).toBe("private");
      expect(url.searchParams.get("format")).toBe("png");
      expect(mockFetch).not.toHaveBeenCalled();
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
      await expect(driver.get("missing", { resourceType: "image" })).rejects.toMatchObject({
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
      await expect(driver.get("abc123", { resourceType: "image" })).rejects.toMatchObject({
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

describe("CloudinaryDriver stable ids and upload status", () => {
  let driver: CloudinaryDriver;
  const small = () =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("data"));
        c.close();
      },
    });
  const sha1Hex = async (s: string) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s))), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  const resource = (over: Record<string, unknown> = {}) =>
    mockResponse({
      public_id: "docs/inv_42",
      version: 3,
      format: "pdf",
      resource_type: "raw",
      type: "upload",
      bytes: 1234,
      secure_url: "https://res.cloudinary.com/demo/raw/upload/v3/docs/inv_42",
      ...over,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new CloudinaryDriver({ cloudName: "demo", apiKey: "key123", apiSecret: "secret456" });
  });

  it("sends the id as public_id with overwrite and the token as signed context", async () => {
    let body: FormData | undefined;
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      body = init.body as FormData;
      return resource();
    });

    await driver.upload(small(), { filename: "r.pdf", path: "docs", id: "inv_42", uploadToken: "tok-1" });

    expect(body!.get("public_id")).toBe("inv_42");
    expect(body!.get("overwrite")).toBe("true");
    expect(body!.get("context")).toBe("fileway_upload_token=tok-1");
    const ts = body!.get("timestamp") as string;
    expect(body!.get("signature")).toBe(
      await sha1Hex(
        `context=fileway_upload_token=tok-1&folder=docs&overwrite=true&public_id=inv_42&timestamp=${ts}` + "secret456",
      ),
    );
  });

  it("pathFor is <folder>/<id>", () => {
    expect(driver.pathFor({ filename: "r.pdf", path: "docs", id: "inv_42" })).toBe("docs/inv_42");
    expect(driver.pathFor({ filename: "r.pdf", id: "inv_42" })).toBe("inv_42");
  });

  it("head tries each resource type and maps the stored token", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("/resources/raw/upload/docs/inv_42")) {
        return resource({ context: { custom: { fileway_upload_token: "tok-1" } } });
      }
      return mockResponse({ error: { message: "not found" } }, 404);
    });

    const object = await driver.head("docs/inv_42");

    expect(object).toMatchObject({ path: "docs/inv_42", size: 1234, uploadToken: "tok-1" });
    expect(mockFetch.mock.calls.map(([u]) => String(u).split("/resources/")[1])).toEqual([
      "image/upload/docs/inv_42",
      "video/upload/docs/inv_42",
      "raw/upload/docs/inv_42",
    ]);
    const headers = (mockFetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${btoa("key123:secret456")}`);
  });

  it("head falls back to the bare id for dynamic-folder accounts", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      String(url).endsWith("/resources/image/upload/inv_42")
        ? resource({ public_id: "inv_42", resource_type: "image" })
        : mockResponse({}, 404),
    );
    await expect(driver.head("docs/inv_42")).resolves.toMatchObject({ path: "inv_42" });
  });

  it("head returns null when no resource type has the asset", async () => {
    mockFetch.mockImplementation(async () => mockResponse({}, 404));
    await expect(driver.head("docs/missing")).resolves.toBeNull();
  });

  it("head throws a typed error on auth failures", async () => {
    mockFetch.mockImplementation(async () => mockResponse({}, 401));
    await expect(driver.head("docs/x")).rejects.toMatchObject({ code: "auth-failed", statusCode: 401 });
  });
});
