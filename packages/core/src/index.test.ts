import { describe, it, expect, vi } from "vitest";
import { FilewayClient, version, abortError, isAbortError, StorageError, ValidationError } from "./index.js";
import type { BaseDriver, UploadOptions, UploadResult } from "./types.js";

describe("version", () => {
  it("should export the current version", () => {
    expect(version).toBe("0.0.1");
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
      delete: vi.fn(async () => true),
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

    expect(driver.upload).toHaveBeenCalledWith(stream, options);
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

    const result = await client.delete("/uploads/test.txt");

    expect(driver.delete).toHaveBeenCalledWith("/uploads/test.txt");
    expect(result).toBe(true);
  });

  it("should call driver.getUrl", async () => {
    const driver = createMockDriver();
    const client = new FilewayClient({ driver });

    const url = await client.getUrl("/uploads/test.txt");

    expect(driver.getUrl).toHaveBeenCalledWith("/uploads/test.txt");
    expect(url).toBe("https://example.com/uploads/test.txt");
  });

  it("should call driver.get", async () => {
    const driver = createMockDriver();
    const client = new FilewayClient({ driver });

    const stream = await client.get("/uploads/test.txt");

    expect(driver.get).toHaveBeenCalledWith("/uploads/test.txt");
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
      delete: vi.fn(async () => true),
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
      delete: vi.fn(async () => true),
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

    expect(driver.upload).toHaveBeenCalledWith(stream, expect.anything());
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
    delete: vi.fn(async () => true),
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
