import { describe, it, expect, vi } from "vitest";
import * as core from "./index.js";
import { FilewayClient, version, abortError, isAbortError, StorageError, ValidationError, encodeCursor, decodeCursor } from "./index.js";
import { isRetryable } from "./retry.js";
import type { BaseDriver, OperationOptions, StoredObject, UploadContext, UploadOptions, UploadResult } from "./types.js";

describe("version", () => {
  it("should export the current version", () => {
    // Injected from package.json by tsup/vitest `define`.
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(version).not.toBe("0.0.0-dev");
  });
});

describe("abortError", () => {
  it("should create a DOMException named AbortError", () => {
    const err = abortError("upload aborted");
    expect(err.name).toBe("AbortError");
    expect(err.message).toBe("upload aborted");
    expect(err instanceof DOMException).toBe(true);
  });
});

describe("StorageError", () => {
  it("should expose a stable machine-readable code", () => {
    const err = new StorageError("not-found", "S3 get failed: 404 Not Found", {
      statusCode: 404,
      provider: "s3",
    });
    expect(err.code).toBe("not-found");
    expect(err.statusCode).toBe(404);
    expect(err.provider).toBe("s3");
    expect(err.message).toBe("S3 get failed: 404 Not Found");
    expect(err instanceof Error).toBe(true);
    expect(err.name).toBe("StorageError");
  });

  it("should wrap a cause", () => {
    const cause = new TypeError("fetch failed");
    const err = new StorageError("network", "s3 network error: fetch failed", { cause });
    expect(err.cause).toBe(cause);
  });

  it("should serialize to JSON with code and message", () => {
    const err = new StorageError("auth-failed", "bad credentials", {
      statusCode: 403,
      provider: "cloudinary",
    });
    expect(err.toJSON()).toEqual({
      name: "StorageError",
      code: "auth-failed",
      message: "bad credentials",
      statusCode: 403,
      provider: "cloudinary",
    });
    expect(JSON.parse(JSON.stringify(err)).code).toBe("auth-failed");
  });
});

describe("isAbortError", () => {
  it("should detect abortError()", () => {
    expect(isAbortError(abortError("upload aborted"))).toBe(true);
  });

  it("should return false for other errors", () => {
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(new StorageError("network", "boom"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe("ValidationError", () => {
  it("should be a StorageError with code validation", () => {
    const err = new ValidationError("filename is required");
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toBeInstanceOf(StorageError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("validation");
    expect(err.name).toBe("ValidationError");
  });
});

describe("FilewayClient", () => {
  const createMockDriver = (): BaseDriver => {
    let counter = 0;
    return {
      name: "mock",
      upload: vi.fn(
        async (
          _stream: ReadableStream<Uint8Array>,
          options: UploadOptions,
        ): Promise<import("./types.js").UploadResult<Record<string, unknown>>> => {
          counter++;
          return {
            id: `file_${counter}`,
            url: `https://example.com/${options.filename}`,
            path: `/uploads/${options.filename}`,
            size: 1024,
            meta: {},
          };
        },
      ),
      delete: vi.fn(async () => {}),
      getUrl: vi.fn(async (path: string) => `https://example.com${path}`),
      get: vi.fn(async () => new ReadableStream<Uint8Array>()),
      getPresignedUrl: vi.fn(async (_path: string, options?: { expiresIn?: number }) =>
        `https://example.com/signed?expiresIn=${options?.expiresIn ?? 3600}`,
      ),
    };
  };

  it("should call driver.upload with stream and options", async () => {
    const driver = createMockDriver();
    const client = new FilewayClient({ driver });
    const stream = new ReadableStream();
    const options: UploadOptions = { filename: "test.txt" };

    await client.upload(stream, options);

    // The client adds a stable id to the caller's options and passes the
    // per-call token separately, as upload context.
    expect(driver.upload).toHaveBeenCalledWith(
      stream,
      { ...options, id: expect.stringMatching(/^[0-9a-f-]{36}$/) },
      { uploadToken: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    );
  });

  it("should run middlewares in order", async () => {
    const driver = createMockDriver();
    const order: string[] = [];
    const middlewares = [
      {
        beforeUpload: async () => {
          order.push("before1");
        },
        afterUpload: async () => {
          order.push("after1");
        },
      },
      {
        beforeUpload: async () => {
          order.push("before2");
        },
        afterUpload: async () => {
          order.push("after2");
        },
      },
    ];

    const client = new FilewayClient({ driver, middlewares });
    const stream = new ReadableStream();
    const options: UploadOptions = { filename: "test.txt" };

    await client.upload(stream, options);

    expect(order).toEqual(["before1", "before2", "after1", "after2"]);
  });

  it("should call driver.delete", async () => {
    const driver = createMockDriver();
    const client = new FilewayClient({ driver });

    await expect(client.delete("/uploads/test.txt")).resolves.toBeUndefined();

    expect(driver.delete).toHaveBeenCalledWith("/uploads/test.txt", undefined);
  });

  it("should call driver.getUrl", async () => {
    const driver = createMockDriver();
    const client = new FilewayClient({ driver });

    const url = await client.getUrl("/uploads/test.txt");

    expect(driver.getUrl).toHaveBeenCalledWith("/uploads/test.txt", undefined);
    expect(url).toBe("https://example.com/uploads/test.txt");
  });

  it("should call driver.get", async () => {
    const driver = createMockDriver();
    const client = new FilewayClient({ driver });

    const stream = await client.get("/uploads/test.txt");

    expect(driver.get).toHaveBeenCalledWith("/uploads/test.txt", undefined);
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  it("should call driver.getPresignedUrl", async () => {
    const driver = createMockDriver();
    const client = new FilewayClient({ driver });

    const url = await client.getPresignedUrl("/uploads/test.txt", { expiresIn: 600 });

    expect(driver.getPresignedUrl).toHaveBeenCalledWith("/uploads/test.txt", { expiresIn: 600 });
    expect(url).toBe("https://example.com/signed?expiresIn=600");
  });

  it("should throw when the driver does not support presigned URLs", async () => {
    const driver = createMockDriver();
    delete driver.getPresignedUrl;
    const client = new FilewayClient({ driver });

    await expect(client.getPresignedUrl("/uploads/test.txt")).rejects.toThrow(
      "driver mock does not support presigned URLs",
    );
    await expect(client.getPresignedUrl("/uploads/test.txt")).rejects.toMatchObject({
      code: "config",
      provider: "mock",
    });
  });

  it("should forward an abort signal to the driver", async () => {
    const driver = createMockDriver();
    const client = new FilewayClient({ driver });
    const controller = new AbortController();
    const options: UploadOptions = { filename: "test.txt", signal: controller.signal };

    await client.upload(new ReadableStream(), options);

    expect(driver.upload).toHaveBeenCalledWith(
      expect.any(ReadableStream),
      expect.objectContaining({ signal: controller.signal }),
      expect.anything(),
    );
  });
});

describe("FilewayClient upload progress", () => {
  const createMockDriver = (): BaseDriver => {
    let counter = 0;
    return {
      name: "mock",
      upload: vi.fn(
        async (
          _stream: ReadableStream<Uint8Array>,
          options: UploadOptions,
        ): Promise<import("./types.js").UploadResult<Record<string, unknown>>> => {
          counter++;
          return {
            id: `file_${counter}`,
            url: `https://example.com/${options.filename}`,
            path: `/uploads/${options.filename}`,
            size: 1024,
            meta: {},
          };
        },
      ),
      delete: vi.fn(async () => {}),
      getUrl: vi.fn(async (path: string) => `https://example.com${path}`),
      get: vi.fn(async () => new ReadableStream<Uint8Array>()),
    };
  };

  const consumingDriver = () => {
    let lastStream: ReadableStream<Uint8Array> | undefined;
    let lastReadBytes = 0;
    const upload = vi.fn(
      async (
        stream: ReadableStream<Uint8Array>,
        _options: UploadOptions,
      ): Promise<UploadResult<Record<string, unknown>>> => {
        lastStream = stream;
        // A real driver pulls the stream; progress events fire as it does.
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        lastReadBytes = bytes.byteLength;
        return {
          id: "file_1",
          url: "https://example.com/test.txt",
          path: "/uploads/test.txt",
          size: lastReadBytes,
          meta: {},
        };
      },
    );
    return {
      name: "mock",
      upload,
      lastStreamBytes: async () => lastReadBytes,
      delete: vi.fn(async () => {}),
      getUrl: vi.fn(async (path: string) => `https://example.com${path}`),
      get: vi.fn(async () => new ReadableStream<Uint8Array>()),
    };
  };

  const streamOf = (...lengths: number[]): ReadableStream<Uint8Array> => {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const len of lengths) {
          controller.enqueue(encoder.encode("x".repeat(len)));
        }
        controller.close();
      },
    });
  };

  it("reports cumulative bytes and an exact final event when size is known", async () => {
    const driver = consumingDriver();
    const client = new FilewayClient({ driver });
    const events: Array<{ bytes: number; total?: number; progress?: number }> = [];
    const total = 3 + 5 + 8;

    await client.upload(streamOf(3, 5, 8), {
      filename: "test.txt",
      size: total,
      onProgress: (p) => events.push(p),
    });

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((e) => e.bytes <= total)).toBe(true);
    const last = events[events.length - 1]!;
    expect(last.bytes).toBe(total);
    expect(last.total).toBe(total);
    expect(last.progress).toBe(1);
  });

  it("omits total and progress when the size is unknown", async () => {
    const driver = consumingDriver();
    const client = new FilewayClient({ driver });
    const events: Array<{ bytes: number; total?: number; progress?: number }> = [];

    await client.upload(streamOf(4, 6), {
      filename: "test.txt",
      onProgress: (p) => events.push(p),
    });

    const last = events[events.length - 1]!;
    expect(last.bytes).toBe(10);
    expect(last.total).toBeUndefined();
    expect(last.progress).toBeUndefined();
  });

  it("reports progress 1 for an empty stream with size 0", async () => {
    const driver = consumingDriver();
    const client = new FilewayClient({ driver });
    const events: Array<{ bytes: number; total?: number; progress?: number }> = [];

    await client.upload(streamOf(), {
      filename: "empty.txt",
      size: 0,
      onProgress: (p) => events.push(p),
    });

    const last = events[events.length - 1]!;
    expect(last.bytes).toBe(0);
    expect(last.total).toBe(0);
    expect(last.progress).toBe(1);
  });

  describe("size after a middleware replaces the stream", () => {
    const sizeRecordingDriver = () => {
      const seen: Array<{ size: number | undefined; bytes: number }> = [];
      const driver: BaseDriver = {
        name: "mock",
        upload: vi.fn(async (stream: ReadableStream<Uint8Array>, options: UploadOptions) => {
          const bytes = (await new Response(stream).arrayBuffer()).byteLength;
          seen.push({ size: options.size, bytes });
          return { id: "f", url: "u", path: "p", size: bytes, meta: {} };
        }),
        delete: vi.fn(async () => {}),
        getUrl: vi.fn(async (p: string) => p),
        get: vi.fn(async () => new ReadableStream<Uint8Array>()),
      };
      return { driver, seen };
    };
    const doubler = (stream: ReadableStream<Uint8Array>) =>
      stream.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
            controller.enqueue(chunk);
          },
        }),
      );

    it("drops a size the middleware did not vouch for", async () => {
      const { driver, seen } = sizeRecordingDriver();
      const client = new FilewayClient({
        driver,
        middlewares: [{ beforeUpload: async (stream) => ({ stream: doubler(stream) }) }],
      });

      await client.upload(streamOf(4), { filename: "a.txt", size: 4 });

      expect(seen).toEqual([{ size: undefined, bytes: 8 }]);
    });

    it("drops the size even when the middleware spreads the old options", async () => {
      const { driver, seen } = sizeRecordingDriver();
      const client = new FilewayClient({
        driver,
        middlewares: [
          {
            beforeUpload: async (stream, options) => ({
              stream: doubler(stream),
              options: { ...options, filename: `${options.filename}.gz` },
            }),
          },
        ],
      });

      await client.upload(streamOf(4), { filename: "a.txt", size: 4 });

      expect(seen).toEqual([{ size: undefined, bytes: 8 }]);
    });

    it("uses the size the middleware returns for the new stream", async () => {
      const { driver, seen } = sizeRecordingDriver();
      const events: Array<{ total?: number }> = [];
      const client = new FilewayClient({
        driver,
        middlewares: [
          { beforeUpload: async (stream, options) => ({ stream: doubler(stream), size: (options.size ?? 0) * 2 }) },
        ],
      });

      await client.upload(streamOf(4), { filename: "a.txt", size: 4, onProgress: (p) => events.push(p) });

      expect(seen).toEqual([{ size: 8, bytes: 8 }]);
      expect(events[events.length - 1]!.total).toBe(8);
    });

    it("keeps a new size set in the returned options", async () => {
      const { driver, seen } = sizeRecordingDriver();
      const client = new FilewayClient({
        driver,
        middlewares: [
          {
            beforeUpload: async (stream, options) => ({
              stream: doubler(stream),
              options: { ...options, size: 8 },
            }),
          },
        ],
      });

      await client.upload(streamOf(4), { filename: "a.txt", size: 4 });

      expect(seen).toEqual([{ size: 8, bytes: 8 }]);
    });

    it("keeps the size when only options change", async () => {
      const { driver, seen } = sizeRecordingDriver();
      const client = new FilewayClient({
        driver,
        middlewares: [{ beforeUpload: async (_stream, options) => ({ options: { ...options, path: "x" } }) }],
      });

      await client.upload(streamOf(4), { filename: "a.txt", size: 4 });

      expect(seen).toEqual([{ size: 4, bytes: 4 }]);
    });
  });

  it("counts bytes after beforeUpload middleware transformation", async () => {
    const driver = consumingDriver();
    const client = new FilewayClient({
      driver,
      middlewares: [
        {
          beforeUpload: async () => {
            const encoder = new TextEncoder();
            return {
              stream: new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(encoder.encode("HEAD"));
                  controller.enqueue(encoder.encode("body"));
                  controller.close();
                },
              }),
            };
          },
        },
      ],
    });
    const events: Array<{ bytes: number }> = [];

    await client.upload(streamOf(4), {
      filename: "test.txt",
      onProgress: (p) => events.push(p),
    });

    expect(await driver.lastStreamBytes()).toBe(8);
    expect(events[events.length - 1]!.bytes).toBe(8);
  });

  it("passes the original stream untouched when onProgress is absent", async () => {
    const driver = createMockDriver();
    const client = new FilewayClient({ driver });
    const stream = streamOf(4);

    await client.upload(stream, { filename: "test.txt" });

    expect(driver.upload).toHaveBeenCalledWith(stream, expect.anything(), expect.anything());
  });

  it("reports every significant chunk immediately and throttles small fast chunks", async () => {
    const driver = consumingDriver();
    const client = new FilewayClient({ driver });
    const events: Array<{ bytes: number }> = [];

    // Large chunks (>= 256 KiB) report per chunk regardless of time.
    const large = 300 * 1024;
    await client.upload(streamOf(large, large), {
      filename: "big.txt",
      size: large * 2,
      onProgress: (p) => events.push(p),
    });
    expect(events.map((e) => e.bytes)).toEqual([large, large * 2, large * 2]);

    // Small chunks on a fast stream coalesce to few events, always ending exact.
    events.length = 0;
    const small = 1024;
    await client.upload(streamOf(...Array(32).fill(small)), {
      filename: "small.txt",
      size: small * 32,
      onProgress: (p) => events.push(p),
    });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.length).toBeLessThanOrEqual(3);
    expect(events[events.length - 1]!.bytes).toBe(small * 32);
  });
});

describe("FilewayClient logging & onError", () => {
  const streamOfBytes = (...lengths: number[]): ReadableStream<Uint8Array> => {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const len of lengths) controller.enqueue(encoder.encode("x".repeat(len)));
        controller.close();
      },
    });
  };

  const okDriver = (): BaseDriver => ({
    name: "mock",
    upload: vi.fn(
      async (): Promise<UploadResult<Record<string, unknown>>> => ({
        id: "file_1",
        url: "https://example.com/test.txt",
        path: "/uploads/test.txt",
        size: 5,
        meta: {},
      }),
    ),
    delete: vi.fn(async () => {}),
    getUrl: vi.fn(async (p: string) => `https://example.com${p}`),
    get: vi.fn(async () => new ReadableStream<Uint8Array>()),
  });

  const failingDriver = (err: Error): BaseDriver => ({
    name: "mock",
    upload: vi.fn(async () => {
      throw err;
    }),
    delete: vi.fn(async () => {
      throw err;
    }),
    getUrl: vi.fn(async () => {
      throw err;
    }),
    get: vi.fn(async () => {
      throw err;
    }),
  });

  it("logs upload started and succeeded with meta", async () => {
    const info = vi.fn();
    const client = new FilewayClient({ driver: okDriver(), logger: { info } });

    await client.upload(streamOfBytes(5), { filename: "test.txt", size: 5 });

    expect(info).toHaveBeenCalledWith(
      "upload started",
      expect.objectContaining({ operation: "upload", filename: "test.txt", size: 5 }),
    );
    expect(info).toHaveBeenCalledWith(
      "upload succeeded",
      expect.objectContaining({
        operation: "upload",
        id: "file_1",
        path: "/uploads/test.txt",
        size: 5,
        durationMs: expect.any(Number),
      }),
    );
  });

  it("reports failures to onError with a typed error and context", async () => {
    const onError = vi.fn();
    const client = new FilewayClient({
      driver: failingDriver(
        new StorageError("network", "s3 network error: fetch failed", { provider: "s3" }),
      ),
      onError,
    });

    await expect(client.get("missing.txt")).rejects.toThrow("s3 network error");

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "network", provider: "s3" }),
      expect.objectContaining({ operation: "get", path: "missing.txt", durationMs: expect.any(Number) }),
    );
  });

  it("skips onError on abort", async () => {
    const onError = vi.fn();
    const client = new FilewayClient({
      driver: failingDriver(abortError("upload aborted")),
      onError,
    });

    await expect(
      client.upload(streamOfBytes(3), { filename: "a.txt" }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(onError).not.toHaveBeenCalled();
  });

  it("logs an error-level event even without onError", async () => {
    const error = vi.fn();
    const client = new FilewayClient({
      driver: failingDriver(new StorageError("not-found", "file not found: x", { provider: "local" })),
      logger: { error },
    });

    await expect(client.get("x")).rejects.toThrow();

    expect(error).toHaveBeenCalledWith(
      "get failed",
      expect.objectContaining({ operation: "get", path: "x" }),
    );
  });

  it("does not let a throwing logger mask a successful upload", async () => {
    const logger = {
      info: vi.fn(() => {
        throw new Error("logger boom");
      }),
    };
    const client = new FilewayClient({ driver: okDriver(), logger });

    await expect(client.upload(streamOfBytes(1), { filename: "a.txt" })).resolves.toMatchObject({
      id: "file_1",
    });
  });

  it("does not let a throwing onError mask the original error", async () => {
    const onError = vi.fn(() => {
      throw new Error("reporter boom");
    });
    const client = new FilewayClient({
      driver: failingDriver(new StorageError("auth-failed", "denied")),
      onError,
    });

    await expect(client.delete("x")).rejects.toMatchObject({ code: "auth-failed" });
  });

  it("awaits an async onError before rejecting", async () => {
    let flushed = false;
    const onError = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      flushed = true;
    });
    const client = new FilewayClient({ driver: failingDriver(new Error("boom")), onError });

    await expect(client.getUrl("x")).rejects.toThrow("boom");
    expect(flushed).toBe(true);
  });

  it("only calls the logger methods that are provided", async () => {
    const debug = vi.fn();
    const client = new FilewayClient({ driver: okDriver(), logger: { debug } });

    await client.getUrl("x");

    expect(debug).not.toHaveBeenCalled();
  });
});

describe("isRetryable", () => {
  it("classifies network and provider-error as retryable", () => {
    expect(isRetryable(new StorageError("network", "boom", { provider: "s3" }))).toBe(true);
    expect(isRetryable(new StorageError("provider-error", "boom", { provider: "s3" }))).toBe(true);
  });

  it("classifies 429 and 5xx statuses as retryable", () => {
    expect(isRetryable(new StorageError("provider-error", "boom", { statusCode: 429 }))).toBe(true);
    expect(isRetryable(new StorageError("provider-error", "boom", { statusCode: 500 }))).toBe(true);
    expect(isRetryable(new StorageError("provider-error", "boom", { statusCode: 503 }))).toBe(true);
  });

  it("never retries validation, config, auth, not-found, or size errors", () => {
    expect(isRetryable(new StorageError("validation", "no"))).toBe(false);
    expect(isRetryable(new StorageError("config", "no"))).toBe(false);
    expect(isRetryable(new StorageError("auth-failed", "no"))).toBe(false);
    expect(isRetryable(new StorageError("not-found", "no"))).toBe(false);
    expect(isRetryable(new StorageError("size-exceeded", "no"))).toBe(false);
  });

  it("never retries abort errors", () => {
    expect(isRetryable(abortError("aborted"))).toBe(false);
  });

  it("retries only TypeError among generic (non-StorageError) errors by default", () => {
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryable(new Error("boom"))).toBe(false);
    expect(isRetryable(new Error("boom"), { retryGenericErrors: true })).toBe(true);
  });

  it("honors retryHttpStatuses and retryGenericErrors config", () => {
    // A non-retryable code (not-found) can still be made retryable via status.
    const err = new StorageError("not-found", "boom", { statusCode: 400 });
    expect(isRetryable(err, { retryHttpStatuses: [400] })).toBe(true);
    expect(isRetryable(err)).toBe(false);
    expect(isRetryable(new Error("boom"), { retryGenericErrors: false })).toBe(false);
  });
});

describe("FilewayClient retry", () => {
  const streamOfBytes = (...lengths: number[]): ReadableStream<Uint8Array> => {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const len of lengths) controller.enqueue(encoder.encode("x".repeat(len)));
        controller.close();
      },
    });
  };

  it("retries delete until it succeeds", async () => {
    const driver: BaseDriver = {
      name: "mock",
      upload: vi.fn(async () => ({ id: "f", url: "u", path: "p", size: 0, meta: {} })),
      delete: vi
        .fn()
        .mockRejectedValueOnce(new StorageError("network", "flaky", { provider: "s3" }))
        .mockRejectedValueOnce(new StorageError("network", "flaky", { provider: "s3" }))
        .mockResolvedValueOnce(undefined),
      getUrl: vi.fn(async (p) => `u${p}`),
      get: vi.fn(async () => new ReadableStream()),
    };
    const client = new FilewayClient({ driver, retry: { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 5, jitter: false } });

    await expect(client.delete("x")).resolves.toBeUndefined();
    expect(driver.delete).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting retries and fires onError once", async () => {
    const onError = vi.fn();
    const driver: BaseDriver = {
      name: "mock",
      upload: vi.fn(async () => ({ id: "f", url: "u", path: "p", size: 0, meta: {} })),
      delete: vi.fn(async () => {
        throw new StorageError("network", "down", { provider: "s3" });
      }),
      getUrl: vi.fn(async (p) => `u${p}`),
      get: vi.fn(async () => new ReadableStream()),
    };
    const client = new FilewayClient({ driver, onError, retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5, jitter: false } });

    await expect(client.delete("x")).rejects.toMatchObject({ code: "network" });
    expect(driver.delete).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-retryable errors", async () => {
    const driver: BaseDriver = {
      name: "mock",
      upload: vi.fn(async () => ({ id: "f", url: "u", path: "p", size: 0, meta: {} })),
      delete: vi.fn(async () => {
        throw new StorageError("auth-failed", "denied", { provider: "s3" });
      }),
      getUrl: vi.fn(async (p) => `u${p}`),
      get: vi.fn(async () => new ReadableStream()),
    };
    const client = new FilewayClient({ driver, retry: { maxRetries: 5, baseDelayMs: 1, jitter: false } });

    await expect(client.delete("x")).rejects.toMatchObject({ code: "auth-failed" });
    expect(driver.delete).toHaveBeenCalledTimes(1);
  });

  it("retries upload using streamFactory to produce fresh streams", async () => {
    let attempt = 0;
    const driver: BaseDriver = {
      name: "mock",
      upload: vi.fn(async (): Promise<UploadResult<Record<string, unknown>>> => {
        attempt++;
        if (attempt < 3) throw new StorageError("network", "flaky", { provider: "s3" });
        return { id: `f${attempt}`, url: "u", path: "p", size: 0, meta: {} };
      }),
      delete: vi.fn(async () => {}),
      getUrl: vi.fn(async (p) => `u${p}`),
      get: vi.fn(async () => new ReadableStream()),
    };
    const factory = vi.fn(() => streamOfBytes(5));
    const client = new FilewayClient({ driver, retry: { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 5, jitter: false } });

    const result = await client.upload(streamOfBytes(5), {
      filename: "a.txt",
      size: 5,
      streamFactory: factory,
    });

    expect(result.id).toBe("f3");
    expect(driver.upload).toHaveBeenCalledTimes(3);
    // 1 initial stream + 2 fresh streams for retries
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("runs middleware on the original options for every retry attempt", async () => {
    const seenPaths: Array<string | undefined> = [];
    let attempt = 0;
    const driver: BaseDriver = {
      name: "mock",
      upload: vi.fn(async (_stream, options): Promise<UploadResult<Record<string, unknown>>> => {
        seenPaths.push(options.path);
        if (++attempt < 3) throw new StorageError("network", "flaky", { provider: "s3" });
        return { id: "f", url: "u", path: options.path ?? "", size: 0, meta: {} };
      }),
      delete: vi.fn(async () => {}),
      getUrl: vi.fn(async (p) => `u${p}`),
      get: vi.fn(async () => new ReadableStream()),
    };
    const client = new FilewayClient({
      driver,
      middlewares: [
        {
          beforeUpload: async (_stream, options) => ({
            options: { ...options, path: `tenant/${options.path ?? ""}` },
          }),
        },
      ],
      retry: { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
    });

    const result = await client.upload(streamOfBytes(1), {
      filename: "a.txt",
      path: "docs",
      streamFactory: () => streamOfBytes(1),
    });

    expect(seenPaths).toEqual(["tenant/docs", "tenant/docs", "tenant/docs"]);
    expect(result.path).toBe("tenant/docs");
  });

  it("does not retry upload without streamFactory", async () => {
    const driver: BaseDriver = {
      name: "mock",
      upload: vi.fn(async () => {
        throw new StorageError("network", "flaky", { provider: "s3" });
      }),
      delete: vi.fn(async () => {}),
      getUrl: vi.fn(async (p) => `u${p}`),
      get: vi.fn(async () => new ReadableStream()),
    };
    const client = new FilewayClient({ driver, retry: { maxRetries: 5, baseDelayMs: 1, jitter: false } });

    await expect(client.upload(streamOfBytes(1), { filename: "a.txt" })).rejects.toMatchObject({ code: "network" });
    expect(driver.upload).toHaveBeenCalledTimes(1);
  });

  it("stops retrying when the signal aborts during the retry delay", async () => {
    const onError = vi.fn();
    const driver: BaseDriver = {
      name: "mock",
      upload: vi.fn(async () => ({ id: "f", url: "u", path: "p", size: 0, meta: {} })),
      delete: vi.fn(async () => {
        throw new StorageError("network", "down", { provider: "s3" });
      }),
      getUrl: vi.fn(async (p) => `u${p}`),
      get: vi.fn(async () => new ReadableStream()),
    };
    const client = new FilewayClient({ driver, onError, retry: { maxRetries: 5, baseDelayMs: 10_000, jitter: false } });
    const controller = new AbortController();

    const pending = client.delete("x", { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(driver.delete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not call the driver when the signal is already aborted", async () => {
    const driver: BaseDriver = {
      name: "mock",
      upload: vi.fn(async () => ({ id: "f", url: "u", path: "p", size: 0, meta: {} })),
      delete: vi.fn(async () => {}),
      getUrl: vi.fn(async (p) => `u${p}`),
      get: vi.fn(async () => new ReadableStream()),
    };
    const client = new FilewayClient({ driver });
    const controller = new AbortController();
    controller.abort();

    await expect(client.get("x", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(driver.get).not.toHaveBeenCalled();
  });

  it("emits a warn log on each retry", async () => {
    const warn = vi.fn();
    const driver: BaseDriver = {
      name: "mock",
      upload: vi.fn(async () => ({ id: "f", url: "u", path: "p", size: 0, meta: {} })),
      delete: vi
        .fn()
        .mockRejectedValueOnce(new StorageError("network", "x", { provider: "s3" }))
        .mockResolvedValueOnce(true),
      getUrl: vi.fn(async (p) => `u${p}`),
      get: vi.fn(async () => new ReadableStream()),
    };
    const client = new FilewayClient({ driver, logger: { warn }, retry: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5, jitter: false } });

    await client.delete("x");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "delete failed, retrying",
      expect.objectContaining({ operation: "retry", attempt: 1, maxRetries: 3, delayMs: expect.any(Number) }),
    );
  });
});

describe("lost-response recovery and upload status", () => {
  const bytes = (n: number) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(n));
        c.close();
      },
    });

  /**
   * A driver backed by an in-memory store. With `loseResponses`, the first
   * uploads are stored but then fail as if the response never arrived.
   */
  function storeDriver({ loseResponses = 0, keepsTokens = true } = {}) {
    const store = new Map<string, StoredObject>();
    const pending = new Set<string>();
    let lost = 0;
    const pathFor = (o: UploadOptions & { id: string }) => `${o.path ? `${o.path}/` : ""}${o.id}-${o.filename}`;
    const driver = {
      name: "store",
      store,
      pending,
      upload: vi.fn(async (stream: ReadableStream<Uint8Array>, o: UploadOptions, context?: UploadContext) => {
        const size = (await new Response(stream).arrayBuffer()).byteLength;
        const path = pathFor({ ...o, id: o.id! });
        const object: StoredObject = {
          id: o.id!,
          url: `mem://${path}`,
          path,
          size,
          meta: {},
          ...(keepsTokens && context ? { uploadToken: context.uploadToken } : {}),
        };
        store.set(path, object);
        if (lost < loseResponses) {
          lost++;
          throw new TypeError("fetch failed");
        }
        return { id: object.id, url: object.url, path, size, meta: {} };
      }),
      delete: vi.fn(async () => {}),
      getUrl: vi.fn(async (p: string) => p),
      get: vi.fn(async () => new ReadableStream<Uint8Array>()),
      pathFor,
      head: vi.fn(async (p: string) => store.get(p) ?? null),
      isPending: vi.fn(async (p: string) => pending.has(p)),
    } satisfies BaseDriver & Record<string, unknown>;
    return driver;
  }
  const fastRetry = { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2, jitter: false };

  it("returns the stored object instead of re-uploading when the response is lost", async () => {
    const driver = storeDriver({ loseResponses: 1 });
    const after = vi.fn(async () => {});
    const info = vi.fn();
    const client = new FilewayClient({
      driver,
      middlewares: [{ afterUpload: after }],
      logger: { info },
      retry: fastRetry,
    });

    // No streamFactory: before, this failed even though the file was stored.
    const result = await client.upload(bytes(5), { filename: "a.txt", size: 5 });

    expect(driver.upload).toHaveBeenCalledTimes(1);
    expect(driver.store.size).toBe(1);
    expect(result.size).toBe(5);
    expect(result).not.toHaveProperty("uploadToken");
    expect(after).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("upload recovered after lost response", expect.objectContaining({ id: result.id }));
  });

  it("uses the same id and token on every attempt", async () => {
    const driver = storeDriver();
    driver.head.mockResolvedValue(null); // nothing stored: force real retries
    let calls = 0;
    driver.upload.mockImplementation(async (_s, o) => {
      if (++calls < 3) throw new StorageError("network", "flaky", { provider: "store" });
      return { id: o.id!, url: "u", path: "p", size: 0, meta: {} };
    });
    const client = new FilewayClient({ driver, retry: fastRetry });

    await client.upload(bytes(1), { filename: "a.txt", streamFactory: () => bytes(1) });

    const seen = driver.upload.mock.calls.map(([, o, context]) => [o.id, context?.uploadToken]);
    expect(seen).toHaveLength(3);
    expect(new Set(seen.map(([id]) => id)).size).toBe(1);
    expect(new Set(seen.map(([, t]) => t)).size).toBe(1);
  });

  it("keeps a caller-supplied id", async () => {
    const driver = storeDriver();
    const client = new FilewayClient({ driver });

    const result = await client.upload(bytes(1), { filename: "a.txt", id: "invoice_42" });

    expect(result.id).toBe("invoice_42");
    expect(driver.upload.mock.calls[0]![1].id).toBe("invoice_42");
  });

  it("does not accept an object left by an older upload with the same id", async () => {
    const driver = storeDriver();
    driver.store.set("invoice_42-a.txt", {
      id: "invoice_42", url: "old", path: "invoice_42-a.txt", size: 5, meta: {}, uploadToken: "someone-else",
    });
    driver.upload.mockRejectedValue(new TypeError("fetch failed"));
    const client = new FilewayClient({ driver, retry: fastRetry });

    await expect(client.upload(bytes(5), { filename: "a.txt", id: "invoice_42", size: 5 })).rejects.toThrow("fetch failed");
  });

  it("does not accept an object of the wrong size", async () => {
    const driver = storeDriver({ loseResponses: 1 });
    driver.head.mockImplementation(async (p: string) => ({ ...driver.store.get(p)!, size: 3 }));
    const client = new FilewayClient({ driver, retry: fastRetry });

    await expect(client.upload(bytes(5), { filename: "a.txt", size: 5 })).rejects.toThrow("fetch failed");
  });

  it("accepts a token-less object (drivers that cannot store tokens) when the size matches", async () => {
    const driver = storeDriver({ loseResponses: 1, keepsTokens: false });
    const client = new FilewayClient({ driver, retry: fastRetry });

    await expect(client.upload(bytes(4), { filename: "a.txt", size: 4 })).resolves.toMatchObject({ size: 4 });
    expect(driver.upload).toHaveBeenCalledTimes(1);
  });

  it("rethrows the original error when the status check itself fails", async () => {
    const driver = storeDriver({ loseResponses: 1 });
    driver.head.mockRejectedValue(new StorageError("auth-failed", "denied"));
    const client = new FilewayClient({ driver, retry: fastRetry });

    await expect(client.upload(bytes(1), { filename: "a.txt" })).rejects.toThrow("fetch failed");
  });

  it("rejects an invalid id", async () => {
    const client = new FilewayClient({ driver: storeDriver() });
    await expect(client.upload(bytes(1), { filename: "a.txt", id: "../escape" })).rejects.toThrow(ValidationError);
  });

  it("reports complete, pending and missing uploads", async () => {
    const driver = storeDriver();
    const client = new FilewayClient({ driver });
    await client.upload(bytes(2), { filename: "a.txt", path: "docs", id: "done" });
    driver.pending.add("docs/busy-a.txt");

    await expect(client.getUploadStatus("done", { filename: "a.txt", path: "docs" })).resolves.toMatchObject({
      state: "complete",
      object: { path: "docs/done-a.txt", size: 2 },
    });
    await expect(client.getUploadStatus("busy", { filename: "a.txt", path: "docs" })).resolves.toEqual({ state: "pending" });
    await expect(client.getUploadStatus("nope", { filename: "a.txt" })).resolves.toEqual({ state: "missing" });
  });

  it("reports unsupported for drivers without status methods", async () => {
    const driver: BaseDriver = {
      name: "plain",
      upload: vi.fn(async () => ({ id: "f", url: "u", path: "p", size: 0, meta: {} })),
      delete: vi.fn(async () => {}),
      getUrl: vi.fn(async (p: string) => p),
      get: vi.fn(async () => new ReadableStream<Uint8Array>()),
    };
    const client = new FilewayClient({ driver });
    await expect(client.getUploadStatus("x", { filename: "a.txt" })).resolves.toEqual({ state: "unsupported" });
  });
});

describe("retry.idleTimeoutMs", () => {
  const chunk = () => new Uint8Array(4);
  const quickRetry = { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2, jitter: false };
  /** A stream that sends `count` chunks, `gapMs` apart. */
  const trickle = (count: number, gapMs: number) => {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
      async pull(c) {
        if (sent === count) return c.close();
        await new Promise((r) => setTimeout(r, gapMs));
        sent++;
        c.enqueue(chunk());
      },
    });
  };
  const okResult = (o: UploadOptions): UploadResult<Record<string, unknown>> => ({
    id: o.id!, url: "u", path: "p", size: 0, meta: {},
  });
  const baseDriver = (upload: BaseDriver["upload"]): BaseDriver => ({
    name: "mock",
    upload: vi.fn(upload),
    delete: vi.fn(async () => {}),
    getUrl: vi.fn(async (p: string) => p),
    get: vi.fn(async () => new ReadableStream<Uint8Array>()),
  });
  /** Never finishes on its own; rejects with AbortError when its signal aborts. */
  const hang = (o: UploadOptions) =>
    new Promise<never>((_, reject) => {
      o.signal?.addEventListener("abort", () => reject(abortError("aborted")), { once: true });
    });

  it("cancels a hung attempt and retries it", async () => {
    let calls = 0;
    const driver = baseDriver(async (stream, o) => {
      calls++;
      if (calls === 1) return hang(o);
      await new Response(stream).arrayBuffer();
      return okResult(o);
    });
    const warn = vi.fn();
    const client = new FilewayClient({ driver, logger: { warn }, retry: { ...quickRetry, idleTimeoutMs: 40 } });

    const result = await client.upload(trickle(1, 0), { filename: "a.bin", streamFactory: () => trickle(1, 0) });

    expect(calls).toBe(2);
    expect(result.id).toBeDefined();
    expect(warn).toHaveBeenCalledWith(
      "upload failed, retrying",
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringMatching(/timed out after 40 ms/) }) }),
    );
  });

  it("does not cut off an upload that is slow but still moving", async () => {
    const driver = baseDriver(async (stream, o) => {
      await new Response(stream).arrayBuffer(); // 8 chunks, 25 ms apart: ~200 ms total
      return okResult(o);
    });
    const client = new FilewayClient({ driver, retry: { ...quickRetry, idleTimeoutMs: 80 } });

    await expect(client.upload(trickle(8, 25), { filename: "a.bin" })).resolves.toBeDefined();
    expect(driver.upload).toHaveBeenCalledTimes(1);
  });

  it("times out waiting for the reply after the body is sent, as a retryable timeout error", async () => {
    const driver = baseDriver(async (stream, o) => {
      await new Response(stream).arrayBuffer();
      return hang(o);
    });
    const onError = vi.fn();
    const client = new FilewayClient({ driver, onError, retry: { ...quickRetry, idleTimeoutMs: 40 } });

    // No streamFactory: the timeout surfaces as the final error.
    await expect(client.upload(trickle(1, 0), { filename: "a.bin" })).rejects.toMatchObject({
      name: "StorageError",
      code: "timeout",
      message: "upload attempt timed out after 40 ms without progress",
    });
    expect(isRetryable(onError.mock.calls[0]![0])).toBe(true);
  });

  it("keeps the caller's own abort final", async () => {
    const driver = baseDriver(async (_s, o) => hang(o));
    const client = new FilewayClient({ driver, retry: { ...quickRetry, idleTimeoutMs: 1000 } });
    const controller = new AbortController();

    const pending = client.upload(trickle(1, 0), {
      filename: "a.bin",
      signal: controller.signal,
      streamFactory: () => trickle(1, 0),
    });
    setTimeout(() => controller.abort(), 20);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(driver.upload).toHaveBeenCalledTimes(1);
  });

  it("stops waiting on a driver that ignores its signal", async () => {
    const driver = baseDriver(() => new Promise<never>(() => {})); // never settles, ignores abort
    const client = new FilewayClient({ driver, retry: { maxRetries: 0, idleTimeoutMs: 30 } });

    await expect(client.upload(trickle(1, 0), { filename: "a.bin" })).rejects.toMatchObject({ code: "timeout" });
  });

  it("limits each attempt of other operations and retries them", async () => {
    const driver = baseDriver(async (_s, o) => okResult(o));
    let calls = 0;
    const signals: (AbortSignal | undefined)[] = [];
    driver.delete = vi.fn((_path: string, options?: OperationOptions) => {
      signals.push(options?.signal);
      return ++calls === 1 ? new Promise<void>(() => {}) : Promise.resolve();
    });
    const client = new FilewayClient({ driver, retry: { ...quickRetry, idleTimeoutMs: 30 } });

    await expect(client.delete("x")).resolves.toBeUndefined();
    expect(calls).toBe(2);
    // The timed-out attempt's request is cancelled, not just abandoned.
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("is off by default and validates its value", () => {
    const driver = baseDriver(async (_s, o) => okResult(o));
    expect(() => new FilewayClient({ driver, retry: { idleTimeoutMs: 0 } })).toThrow(/idleTimeoutMs/);
    expect(() => new FilewayClient({ driver, retry: { idleTimeoutMs: Number.NaN } })).toThrow(/idleTimeoutMs/);
    expect(() => new FilewayClient({ driver })).not.toThrow();
  });
});

describe("1.0 API surface", () => {
  it("exports only the client, types, errors and driver helpers", () => {
    expect(Object.keys(core).sort()).toEqual(
      [
        "FilewayClient",
        "StorageError",
        "ValidationError",
        "abortError",
        "decodeCursor",
        "encodeCursor",
        "isAbortError",
        "urlEncodePath",
        "validateUploadOptions",
        "version",
      ].sort(),
    );
  });

  it("retries the timeout and rate-limited codes", () => {
    expect(isRetryable(new StorageError("timeout", "slow"))).toBe(true);
    expect(isRetryable(new StorageError("rate-limited", "slow down", { statusCode: 429 }))).toBe(true);
  });

  function optionsDriver() {
    return {
      name: "opts",
      upload: vi.fn(async (_s: ReadableStream<Uint8Array>, o: UploadOptions) => ({
        id: o.id!, url: "u", path: "p", size: 0, meta: { bucket: "b" },
      })),
      delete: vi.fn(async (_p: string, _o?: OperationOptions & { version?: string }) => {}),
      getUrl: vi.fn(async (p: string, _o?: OperationOptions & { version?: string }) => p),
      get: vi.fn(async (_p: string, _o?: OperationOptions & { version?: string }) => new ReadableStream<Uint8Array>()),
      getPresignedUrl: vi.fn(async (p: string, _o?: { expiresIn?: number; signal?: AbortSignal; version?: string }) => p),
    };
  }

  it("passes the caller's signal and driver-specific options to the driver", async () => {
    const driver = optionsDriver();
    const client = new FilewayClient({ driver });
    const controller = new AbortController();

    await client.delete("a", { version: "2", signal: controller.signal });
    await client.getUrl("a", { version: "2" });
    await client.get("a", { signal: controller.signal });
    await client.getPresignedUrl("a", { expiresIn: 60, version: "2" });

    expect(driver.delete).toHaveBeenCalledWith("a", { version: "2", signal: controller.signal });
    expect(driver.getUrl).toHaveBeenCalledWith("a", { version: "2" });
    expect(driver.get).toHaveBeenCalledWith("a", { signal: controller.signal });
    expect(driver.getPresignedUrl).toHaveBeenCalledWith("a", { expiresIn: 60, version: "2" });
  });

  it("aborts the driver's request when the caller aborts", async () => {
    const driver = optionsDriver();
    driver.get.mockImplementation(
      (_p, o) =>
        new Promise((_resolve, reject) => {
          o?.signal?.addEventListener("abort", () => reject(abortError("get aborted")));
        }),
    );
    const client = new FilewayClient({ driver });
    const controller = new AbortController();
    const pending = client.get("a", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(driver.get).toHaveBeenCalledTimes(1);
  });

  it("gives afterUpload the driver's typed meta and the upload options", async () => {
    const driver = optionsDriver();
    const seen: unknown[] = [];
    const client = new FilewayClient({
      driver,
      middlewares: [
        {
          afterUpload: async (result, options) => {
            // Compile-time check: `meta.bucket` is typed from the driver.
            const bucket: string = result.meta.bucket;
            seen.push(bucket, options.filename, options.id);
          },
        },
      ],
    });
    await client.upload(new ReadableStream(), { filename: "a.txt", id: "abc" });
    expect(seen).toEqual(["b", "a.txt", "abc"]);
  });
});

describe("list, stat, copy, move", () => {
  function storage(files: Record<string, number>, { withMove = true, withCopy = true } = {}) {
    const store = new Map(Object.entries(files));
    const driver = {
      name: "mem",
      upload: vi.fn(async () => ({ id: "x", url: "u", path: "p", size: 0, meta: {} })),
      delete: vi.fn(async (p: string) => {
        store.delete(p);
      }),
      getUrl: vi.fn(async (p: string) => p),
      get: vi.fn(async () => new ReadableStream<Uint8Array>()),
      head: vi.fn(async (p: string) => {
        const size = store.get(p);
        return size === undefined ? null : { id: p, url: p, path: p, size, meta: { etag: `e${size}` } };
      }),
      list: vi.fn(async (o?: import("./types.js").ListOptions) => {
        const all = [...store.keys()].filter((k) => k.startsWith(o?.prefix ?? "")).sort();
        const start = o?.cursor ? decodeCursor<number>(o.cursor) : 0;
        const limit = o?.limit ?? 100;
        const slice = all.slice(start, start + limit);
        return {
          objects: slice.map((path) => ({ path, size: store.get(path)! })),
          folders: [],
          ...(start + limit < all.length ? { cursor: encodeCursor(start + limit) } : {}),
        };
      }),
      ...(withCopy
        ? {
            copy: vi.fn(async (from: string, to: string, o?: import("./types.js").CopyOptions) => {
              if (!store.has(from)) throw new StorageError("not-found", "no source");
              if (store.has(to) && !o?.overwrite) throw new StorageError("conflict", "exists");
              store.set(to, store.get(from)!);
            }),
          }
        : {}),
      ...(withMove
        ? {
            move: vi.fn(async (from: string, to: string) => {
              if (!store.has(from)) throw new StorageError("not-found", "no source");
              store.set(to, store.get(from)!);
              store.delete(from);
            }),
          }
        : {}),
    };
    return { driver, store };
  }
  const fast = { maxRetries: 2, baseDelayMs: 1, jitter: false };

  it("round-trips cursors and rejects garbage", () => {
    expect(decodeCursor(encodeCursor({ a: "é/ü", n: 3 }))).toEqual({ a: "é/ü", n: 3 });
    expect(() => decodeCursor("not a cursor!")).toThrow(ValidationError);
  });

  it("lists one page and walks every page with listAll", async () => {
    const { driver } = storage({ "a/1": 1, "a/2": 2, "a/3": 3, "b/1": 4 });
    const client = new FilewayClient({ driver });
    const page = await client.list({ prefix: "a/", limit: 2 });
    expect(page.objects.map((o) => o.path)).toEqual(["a/1", "a/2"]);
    expect(page.cursor).toBeDefined();
    const all: string[] = [];
    for await (const o of client.listAll({ prefix: "a/", limit: 2 })) all.push(o.path);
    expect(all).toEqual(["a/1", "a/2", "a/3"]);
  });

  it("validates list options", async () => {
    const { driver } = storage({});
    const client = new FilewayClient({ driver });
    await expect(client.list({ limit: 0 })).rejects.toThrow(ValidationError);
    await expect(client.list({ prefix: "../etc" })).rejects.toThrow(ValidationError);
  });

  it("stats a file, returning null when missing", async () => {
    const { driver } = storage({ "a.txt": 5 });
    const client = new FilewayClient({ driver });
    await expect(client.stat("a.txt")).resolves.toMatchObject({ size: 5 });
    await expect(client.stat("b.txt")).resolves.toBeNull();
  });

  it("copies and reports conflicts", async () => {
    const { driver, store } = storage({ "a.txt": 5, "b.txt": 9 });
    const client = new FilewayClient({ driver });
    await client.copy("a.txt", "c.txt");
    expect(store.get("c.txt")).toBe(5);
    await expect(client.copy("a.txt", "b.txt")).rejects.toMatchObject({ code: "conflict" });
    await client.copy("a.txt", "b.txt", { overwrite: true });
    expect(store.get("b.txt")).toBe(5);
    await expect(client.copy("a.txt", "a.txt")).rejects.toThrow(ValidationError);
  });

  it("treats a conflict on a retried copy as success when the copy already landed", async () => {
    const { driver, store } = storage({ "a.txt": 5 });
    const copy = driver.copy!;
    let calls = 0;
    driver.copy = vi.fn(async (from: string, to: string, o?: import("./types.js").CopyOptions) => {
      await copy(from, to, o);
      if (++calls === 1) throw new StorageError("network", "response lost");
    }) as typeof copy;
    const client = new FilewayClient({ driver, retry: fast });
    await expect(client.copy("a.txt", "b.txt")).resolves.toBeUndefined();
    expect(store.get("b.txt")).toBe(5);
  });

  it("moves natively, and recovers a lost move response", async () => {
    const { driver, store } = storage({ "a.txt": 5 });
    const move = driver.move!;
    let calls = 0;
    driver.move = vi.fn(async (from: string, to: string) => {
      await move(from, to);
      if (++calls === 1) throw new StorageError("network", "response lost");
    }) as typeof move;
    const client = new FilewayClient({ driver, retry: fast });
    await client.move("a.txt", "b.txt");
    expect([...store.keys()]).toEqual(["b.txt"]);
  });

  it("falls back to copy and delete when the driver cannot move", async () => {
    const { driver, store } = storage({ "a.txt": 5 }, { withMove: false });
    const client = new FilewayClient({ driver });
    await client.move("a.txt", "b.txt");
    expect([...store.keys()]).toEqual(["b.txt"]);
    expect(driver.delete).toHaveBeenCalledWith("a.txt", undefined);
  });

  it("reports unsupported operations as config errors", async () => {
    const { driver } = storage({}, { withMove: false, withCopy: false });
    const { list: _list, head: _head, ...bare } = driver;
    const client = new FilewayClient({ driver: bare });
    await expect(client.list()).rejects.toMatchObject({ code: "config" });
    await expect(client.stat("a")).rejects.toMatchObject({ code: "config" });
    await expect(client.copy("a", "b")).rejects.toMatchObject({ code: "config" });
    await expect(client.move("a", "b")).rejects.toMatchObject({ code: "config" });
  });

  it("does not retry conflicts", async () => {
    const { driver } = storage({ "a.txt": 5, "b.txt": 1 });
    const client = new FilewayClient({ driver, retry: fast });
    await expect(client.copy("a.txt", "b.txt")).rejects.toMatchObject({ code: "conflict" });
    expect(driver.copy).toHaveBeenCalledTimes(1);
  });
});

describe("plugins, events and handler", () => {
  function memDriver() {
    const store = new Map<string, number>();
    return {
      name: "mem",
      store,
      upload: vi.fn(async (stream: ReadableStream<Uint8Array>, o: UploadOptions) => {
        const size = (await new Response(stream).arrayBuffer()).byteLength;
        const path = `${o.path ? `${o.path}/` : ""}${o.id}-${o.filename}`;
        store.set(path, size);
        return { id: o.id!, url: `mem://${path}`, path, size, meta: {} };
      }),
      delete: vi.fn(async (p: string, _o?: OperationOptions) => {
        store.delete(p);
      }),
      getUrl: vi.fn(async (p: string) => p),
      get: vi.fn(async (p: string, _o?: OperationOptions) => {
        if (!store.has(p)) throw new StorageError("not-found", `missing ${p}`, { statusCode: 404 });
        return new ReadableStream<Uint8Array>();
      }),
      list: vi.fn(async () => ({ objects: [...store].map(([path, size]) => ({ path, size })), folders: [] })),
      copy: vi.fn(async (from: string, to: string) => {
        store.set(to, store.get(from)!);
      }),
    };
  }
  const bytes = (n: number) =>
    new ReadableStream<Uint8Array>({ start: (c) => { c.enqueue(new Uint8Array(n)); c.close(); } });
  const collect = () => {
    const events: import("./types.js").FilewayEvent[] = [];
    return { events, plugin: { id: "collect", onEvent: (e: import("./types.js").FilewayEvent) => void events.push(e) } };
  };

  it("emits one event per operation with outcome, attempts, timing and attribution", async () => {
    const driver = memDriver();
    const { events, plugin } = collect();
    const client = new FilewayClient({ driver, plugins: [plugin] });

    const result = await client.upload(bytes(5), { filename: "a.txt", mimeType: "text/plain", actor: "user_42", tags: { tenant: "acme" } });
    await client.list({ actor: "user_42" });
    await client.copy(result.path, "b.txt");
    await client.move("b.txt", "c.txt"); // no native move: copy + delete events
    await client.delete("c.txt");

    expect(events.map((e) => e.operation)).toEqual(["upload", "list", "copy", "copy", "delete", "delete"]);
    expect(events[0]).toMatchObject({
      operation: "upload",
      outcome: "success",
      path: result.path,
      size: 5,
      mimeType: "text/plain",
      attempts: 1,
      driver: "mem",
      actor: "user_42",
      tags: { tenant: "acme" },
    });
    expect(events[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(events[0]!.time).toString()).not.toBe("Invalid Date");
    expect(events[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(events[1]).toMatchObject({ operation: "list", actor: "user_42" });
    expect(events[1]).not.toHaveProperty("tags");
  });

  it("never passes actor or tags to drivers or middleware", async () => {
    const driver = memDriver();
    const seen: UploadOptions[] = [];
    const client = new FilewayClient({ driver, middlewares: [{ beforeUpload: async (_s, o) => void seen.push(o) }] });
    await client.upload(bytes(1), { filename: "a.txt", actor: "u1", tags: { t: "x" } });
    await client.delete("x", { actor: "u1" });
    expect(seen[0]).not.toHaveProperty("actor");
    expect(driver.upload.mock.calls[0]![1]).not.toHaveProperty("tags");
    expect(driver.delete).toHaveBeenCalledWith("x", undefined);
  });

  it("reports failures with the error code and attempt count, and aborts as aborted", async () => {
    const driver = memDriver();
    const { events, plugin } = collect();
    let calls = 0;
    driver.get.mockImplementation(async () => {
      if (++calls < 3) throw new StorageError("network", "flaky");
      throw new StorageError("not-found", "gone", { statusCode: 404 });
    });
    const client = new FilewayClient({ driver, plugins: [plugin], retry: { maxRetries: 3, baseDelayMs: 1, jitter: false } });
    await expect(client.get("x")).rejects.toMatchObject({ code: "not-found" });
    expect(events[0]).toMatchObject({
      operation: "get",
      outcome: "error",
      attempts: 3,
      error: { name: "StorageError", code: "not-found", statusCode: 404, message: "gone" },
    });

    const controller = new AbortController();
    controller.abort();
    await expect(client.delete("x", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(events[1]).toMatchObject({ operation: "delete", outcome: "aborted" });
    expect(events[1]).not.toHaveProperty("error");
  });

  it("keeps operations working when a plugin's onEvent throws or rejects", async () => {
    const warn = vi.fn();
    const client = new FilewayClient({
      driver: memDriver(),
      logger: { warn },
      plugins: [
        { id: "throws", onEvent: () => { throw new Error("sync boom"); } },
        { id: "rejects", onEvent: async () => { throw new Error("async boom"); } },
      ],
    });
    await expect(client.upload(bytes(1), { filename: "a.txt" })).resolves.toBeDefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledWith("plugin onEvent failed", expect.objectContaining({ plugin: "throws" }));
    expect(warn).toHaveBeenCalledWith("plugin onEvent failed", expect.objectContaining({ plugin: "rejects" }));
  });

  it("runs init once with the client, and plugin middleware after the app's", async () => {
    const order: string[] = [];
    const init = vi.fn();
    const client = new FilewayClient({
      driver: memDriver(),
      middlewares: [{ beforeUpload: async () => void order.push("app") }],
      plugins: [{ id: "p", init, middlewares: [{ beforeUpload: async () => void order.push("plugin") }] }],
    });
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0]![0]).toMatchObject({ client, driverName: "mem" });
    await client.upload(bytes(1), { filename: "a.txt" });
    expect(order).toEqual(["app", "plugin"]);
  });

  it("rejects duplicate plugin ids, duplicate routes and malformed route keys", () => {
    const driver = memDriver();
    const ok = async () => new Response("ok");
    expect(() => new FilewayClient({ driver, plugins: [{ id: "a" }, { id: "a" }] })).toThrow(/share the id "a"/);
    expect(
      () => new FilewayClient({ driver, plugins: [{ id: "a", routes: { "GET /x": ok } }, { id: "b", routes: { "GET /x": ok } }] }),
    ).toThrow(/registered twice/);
    expect(() => new FilewayClient({ driver, plugins: [{ id: "a", routes: { "FETCH /x": ok } }] })).toThrow(StorageError);
    expect(() => new FilewayClient({ driver, plugins: [{ id: "a", routes: { "GET x": ok } }] })).toThrow(StorageError);
  });

  it("routes requests under basePath, with wildcards, 404, 405 and 500", async () => {
    const error = vi.fn();
    const client = new FilewayClient({
      driver: memDriver(),
      logger: { error },
      plugins: [
        {
          id: "files",
          routes: {
            "GET /health": async (_req, ctx) => Response.json({ driver: ctx.driverName }),
            "GET /files/*": async (_req, ctx) => new Response(ctx.params.wildcard ?? ""),
            "GET /files/special": async () => new Response("exact"),
            "POST /boom": async () => {
              throw new Error("route bug");
            },
          },
        },
      ],
    });
    const at = (path: string, method = "GET") => client.handler.fetch(new Request(`https://app.test${path}`, { method }));

    expect(await (await at("/api/fileway/health")).json()).toEqual({ driver: "mem" });
    expect(await (await at("/api/fileway/files/a/b c.txt")).text()).toBe("a/b%20c.txt");
    expect(await (await at("/api/fileway/files/special")).text()).toBe("exact");
    expect((await at("/api/fileway/nope")).status).toBe(404);
    expect((await at("/elsewhere/health")).status).toBe(404);
    const wrong = await at("/api/fileway/health", "DELETE");
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("GET");
    const boom = await at("/api/fileway/boom", "POST");
    expect(boom.status).toBe(500);
    expect(await boom.json()).toEqual({ error: "internal_error" });
    expect(error).toHaveBeenCalledWith("plugin route failed", expect.objectContaining({ path: "/boom" }));
  });

  it("exposes the same handler under every method name and honors a custom basePath", async () => {
    const client = new FilewayClient({
      driver: memDriver(),
      basePath: "/files-api/",
      plugins: [{ id: "p", routes: { "PUT /x": async () => new Response("put") } }],
    });
    const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, fetch } = client.handler;
    expect(new Set([GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, fetch]).size).toBe(1);
    const res = await PUT(new Request("https://app.test/files-api/x", { method: "PUT" }));
    expect(await res.text()).toBe("put");
  });
});

describe("app-signed links", () => {
  const SECRET = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
  const SECRET2 = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => 200 - i)));
  const ORIGIN = "https://files.example.com";

  function disk({ range = true, limit, native = false }: { range?: boolean; limit?: number; native?: boolean } = {}) {
    const store = new Map<string, { bytes: Uint8Array; type?: string }>();
    store.set("photos/cat.png", { bytes: Uint8Array.from({ length: 10 }, (_, i) => i) });
    store.set("docs/report.pdf", { bytes: new Uint8Array(3) });
    store.set("pages/x.html", { bytes: new Uint8Array(3) });
    store.set("sneaky.png", { bytes: new Uint8Array(3), type: "text/html" });
    const driver = {
      name: "disk",
      store,
      capabilities: { range, ...(limit !== undefined ? { maxUploadBytes: limit } : {}) },
      upload: vi.fn(async (stream: ReadableStream<Uint8Array>, o: UploadOptions) => {
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        const ext = o.filename.includes(".") ? `.${o.filename.split(".").pop()}` : "";
        const path = `${o.path ? `${o.path}/` : ""}${o.id}${ext}`;
        store.set(path, { bytes });
        return { id: o.id!, url: path, path, size: bytes.byteLength, meta: {} };
      }),
      delete: vi.fn(async () => {}),
      getUrl: vi.fn(async (p: string) => p),
      head: vi.fn(async (p: string) => {
        const o = store.get(p);
        if (!o) return null;
        return { id: p, url: p, path: p, size: o.bytes.byteLength, meta: { etag: '"e1"' }, ...(o.type ? { contentType: o.type } : {}) };
      }),
      get: vi.fn(async (p: string, opts?: import("./types.js").GetOptions) => {
        const o = store.get(p);
        if (!o) throw new StorageError("not-found", "missing");
        const bytes = opts?.range ? o.bytes.slice(opts.range.start, (opts.range.end ?? o.bytes.length - 1) + 1) : o.bytes;
        return new Response(bytes as BodyInit).body!;
      }),
      ...(native ? { getPresignedUrl: vi.fn(async (p: string) => `https://native/${p}`) } : {}),
    };
    return driver;
  }
  const make = (extra: Partial<import("./types.js").LinksConfig> = {}, driverOpts = {}) => {
    const driver = disk(driverOpts);
    const events: import("./types.js").FilewayEvent[] = [];
    const client = new FilewayClient({
      driver,
      plugins: [{ id: "events", onEvent: (e) => void events.push(e) }],
      links: { secret: SECRET, origin: ORIGIN, ...extra },
    });
    return { client, driver, events };
  };
  const call = (client: { handler: { fetch(r: Request): Promise<Response> } }, url: string, init?: RequestInit) =>
    client.handler.fetch(new Request(url, init));

  it("rejects short secrets and relative origins", () => {
    expect(() => make({ secret: btoa("too short") })).toThrow(/at least 32 bytes/);
    expect(() => make({ origin: "files.example.com" })).toThrow(/absolute URL/);
  });

  it("signs a download link and serves the file with safe headers", async () => {
    const { client, events } = make();
    const url = await client.getPresignedUrl("photos/cat.png", { expiresIn: 600 });
    expect(url.startsWith(`${ORIGIN}/api/fileway/files/photos/cat.png?`)).toBe(true);
    const res = await call(client, url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="cat.png"; filename*=UTF-8''cat.png`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(res.headers.get("etag")).toBe('"e1"');
    expect(res.headers.get("content-length")).toBe("10");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(Uint8Array.from({ length: 10 }, (_, i) => i));
    expect(events.at(-1)).toMatchObject({ operation: "get", outcome: "success", actor: "link", path: "photos/cat.png" });
  });

  it("opens only safe types inline", async () => {
    const { client } = make({ inlineTypes: ["text/plain"] });
    const pdf = await call(client, await client.getPresignedUrl("docs/report.pdf"));
    expect(pdf.headers.get("content-disposition")).toMatch(/^inline;/);
    // Chrome's PDF viewer does not render under a sandbox CSP; PDFs keep nosniff only.
    expect(pdf.headers.get("content-security-policy")).toBeNull();
    expect(pdf.headers.get("x-content-type-options")).toBe("nosniff");
    const html = await call(client, await client.getPresignedUrl("pages/x.html"));
    expect(html.headers.get("content-disposition")).toMatch(/^attachment;/);
    await expect(client.getPresignedUrl("pages/x.html", { disposition: "inline" })).rejects.toThrow(ValidationError);
    await expect(client.getPresignedUrl("notes.txt", { disposition: "inline" })).resolves.toContain("d=i");
    // A stored type that can run script downloads, whatever the link says.
    const sneaky = await call(client, await client.getPresignedUrl("sneaky.png"));
    expect(sneaky.headers.get("content-type")).toBe("text/html");
    expect(sneaky.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("refuses tampered, malformed and expired links", async () => {
    const { client } = make();
    const url = new URL(await client.getPresignedUrl("photos/cat.png", { filename: "cat.png" }));
    const tamper = (fn: (u: URL) => void) => {
      const u = new URL(url);
      fn(u);
      return call(client, u.href);
    };
    expect((await tamper((u) => (u.pathname = u.pathname.replace("cat.png", "dog.png")))).status).toBe(403);
    expect((await tamper((u) => u.searchParams.set("exp", String(Number(u.searchParams.get("exp")) + 60)))).status).toBe(403);
    expect((await tamper((u) => u.searchParams.set("d", "a"))).status).toBe(403);
    expect((await tamper((u) => u.searchParams.set("fn", "other.png"))).status).toBe(403);
    expect((await tamper((u) => u.searchParams.set("sig", "AAAA"))).status).toBe(403);

    vi.useFakeTimers();
    try {
      const short = await client.getPresignedUrl("photos/cat.png", { expiresIn: 1 });
      vi.setSystemTime(Date.now() + 5000);
      const res = await call(client, short);
      expect(res.status).toBe(403);
      expect(res.headers.get("fileway-error")).toBe("expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("verifies with every configured secret, so secrets can rotate", async () => {
    const before = make({ secret: SECRET }).client;
    const url = await before.getPresignedUrl("photos/cat.png");
    expect((await call(make({ secret: [SECRET2, SECRET] }).client, url)).status).toBe(200);
    expect((await call(make({ secret: SECRET2 }).client, url)).status).toBe(403);
  });

  it("serves ranges as 206 when the driver supports them", async () => {
    const { client } = make();
    const url = await client.getPresignedUrl("photos/cat.png");
    const part = await call(client, url, { headers: { range: "bytes=2-4" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(part.headers.get("content-length")).toBe("3");
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([2, 3, 4]);
    const tail = await call(client, url, { headers: { range: "bytes=-2" } });
    expect([...new Uint8Array(await tail.arrayBuffer())]).toEqual([8, 9]);
    expect((await call(client, url, { headers: { range: "bytes=50-60" } })).status).toBe(416);

    const plain = make({}, { range: false }).client;
    const full = await call(plain, await plain.getPresignedUrl("photos/cat.png"), { headers: { range: "bytes=2-4" } });
    expect(full.status).toBe(200);
    expect(full.headers.get("accept-ranges")).toBeNull();
  });

  it("answers HEAD without a body, and 404 for a missing file", async () => {
    const { client, driver } = make();
    const head = await call(client, await client.getPresignedUrl("photos/cat.png"), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("10");
    expect(driver.get).not.toHaveBeenCalled();
    expect((await call(client, await client.getPresignedUrl("missing.png"))).status).toBe(404);
  });

  it("runs check for links with an id", async () => {
    const check = vi.fn(async (link: import("./types.js").VerifiedLink) => link.id !== "revoked");
    const { client } = make({ check });
    expect((await call(client, await client.getPresignedUrl("photos/cat.png", { id: "share1" }))).status).toBe(200);
    expect((await call(client, await client.getPresignedUrl("photos/cat.png", { id: "revoked" }))).status).toBe(403);
    await call(client, await client.getPresignedUrl("photos/cat.png"));
    expect(check).toHaveBeenCalledTimes(2);
    expect(check.mock.calls[0]![0]).toMatchObject({ method: "GET", path: "photos/cat.png", id: "share1", disposition: "inline" });
  });

  it("uses native presigning in fallback mode and app links in always mode", async () => {
    const fallback = make({}, { native: true }).client;
    await expect(fallback.getPresignedUrl("photos/cat.png")).resolves.toBe("https://native/photos/cat.png");
    const always = make({ mode: "always" }, { native: true }).client;
    await expect(always.getPresignedUrl("photos/cat.png")).resolves.toMatch(/^https:\/\/files\.example\.com\//);
  });

  it("issues upload links that write exactly one object within the limit", async () => {
    const { client, driver, events } = make({}, { limit: 16 });
    const link = await client.getPresignedUploadUrl({ filename: "avatar.png", path: "avatars", id: "u42", mimeType: "image/png" });
    expect(link).toMatchObject({ method: "PUT", id: "u42", headers: { "content-type": "image/png" } });
    const put = (url: string, body: BodyInit, headers: Record<string, string> = {}) =>
      call(client, url, { method: "PUT", body, headers, duplex: "half" } as RequestInit);

    const ok = await put(link.url, new Uint8Array(8));
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ id: "u42", path: "avatars/u42.png", size: 8 });
    expect(driver.upload.mock.calls[0]![1]).toMatchObject({ filename: "avatar.png", path: "avatars", id: "u42", mimeType: "image/png" });
    expect(events.at(-1)).toMatchObject({ operation: "upload", actor: "link", tags: { linkId: "u42" } });

    // Reusing the link overwrites the same object rather than creating new ones.
    expect((await put(link.url, new Uint8Array(4))).status).toBe(201);
    expect(driver.store.get("avatars/u42.png")!.bytes.byteLength).toBe(4);

    const stream = new ReadableStream<Uint8Array>({ start: (c) => { c.enqueue(new Uint8Array(10)); c.enqueue(new Uint8Array(10)); c.close(); } });
    expect((await put(link.url, stream)).status).toBe(413);

    const tampered = new URL(link.url);
    tampered.searchParams.set("max", "999999");
    expect((await put(tampered.href, new Uint8Array(1))).status).toBe(403);
  });

  it("needs a size limit from the link or the driver", async () => {
    const { client } = make();
    await expect(client.getPresignedUploadUrl({ filename: "a.txt" })).rejects.toThrow(/maxSize is required/);
    await expect(client.getPresignedUploadUrl({ filename: "a.txt", maxSize: 100 })).resolves.toMatchObject({ method: "PUT" });
  });

  it("answers CORS preflights for allowed origins only", async () => {
    const { client } = make({ cors: ["https://app.example.com"] });
    const pre = await call(client, `${ORIGIN}/api/fileway/upload`, { method: "OPTIONS", headers: { origin: "https://app.example.com" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(pre.headers.get("access-control-allow-methods")).toBe("GET, HEAD, PUT");
    const other = await call(client, `${ORIGIN}/api/fileway/upload`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("is off without links config, and plugins cannot take its routes", async () => {
    const plain = new FilewayClient({ driver: disk() });
    await expect(plain.getPresignedUploadUrl({ filename: "a.txt", maxSize: 1 })).rejects.toMatchObject({ code: "config" });
    await expect(plain.getPresignedUrl("photos/cat.png")).rejects.toMatchObject({ code: "config" });
    expect((await call(plain, `${ORIGIN}/api/fileway/files/photos/cat.png`)).status).toBe(404);
    expect(
      () =>
        new FilewayClient({
          driver: disk(),
          links: { secret: SECRET, origin: ORIGIN },
          plugins: [{ id: "p", routes: { "GET /files/*": async () => new Response() } }],
        }),
    ).toThrow(/registered twice/);
  });
});
