import { describe, it, expect, vi } from "vitest";
import { FilewayClient, version } from "./index.js";
import type { BaseDriver, UploadOptions } from "./types.js";

describe("version", () => {
  it("should export the current version", () => {
    expect(version).toBe("0.0.1");
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
});
