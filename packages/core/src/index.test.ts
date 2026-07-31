import { describe, it, expect, vi } from "vitest";
import { FilewayClient, version, abortError } from "./index.js";
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
