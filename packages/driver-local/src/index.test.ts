import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FilewayClient } from "@fileway/core";
import { LocalDriver } from "./index.js";

describe("LocalDriver", () => {
  let tmpDir: string;
  let driver: LocalDriver;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "driver-local-test-"));
    driver = new LocalDriver({ directory: tmpDir });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should upload a stream to disk", async () => {
    const content = "hello world";
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(content));
        controller.close();
      },
    });

    const result = await driver.upload(stream, { filename: "test.txt" });

    expect(result.id).toBeDefined();
    expect(result.path).toMatch(/\.txt$/);
    expect(result.size).toBe(content.length);
    expect(result.meta.localPath).toContain(tmpDir);
    expect(existsSync(result.meta.localPath)).toBe(true);
    expect(readFileSync(result.meta.localPath, "utf-8")).toBe(content);
  });

  it("should store files under the configured directory", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data"));
        controller.close();
      },
    });

    const result = await driver.upload(stream, { filename: "file.txt" });

    expect(result.meta.localPath.startsWith(tmpDir)).toBe(true);
  });

  it("should delete a file from disk", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data"));
        controller.close();
      },
    });

    const result = await driver.upload(stream, { filename: "to-delete.txt" });

    expect(existsSync(result.meta.localPath)).toBe(true);

    const deleted = await driver.delete(result.path);

    expect(deleted).toBe(true);
    expect(existsSync(result.meta.localPath)).toBe(false);
  });

  it("should return false when deleting non-existent file", async () => {
    const result = await driver.delete("nonexistent.txt");
    expect(result).toBe(false);
  });

  it("should generate a URL", async () => {
    const url = await driver.getUrl("test.txt");
    expect(url).toBe(`file://${tmpDir}/test.txt`);
  });

  it("should stream a stored file back", async () => {
    const content = "file contents";
    const result = await driver.upload(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(content));
          controller.close();
        },
      }),
      { filename: "read.txt" },
    );

    const stream = await driver.get(result.path);
    const text = await new Response(stream).text();

    expect(text).toBe(content);
  });

  it("should throw when streaming a missing file", async () => {
    await expect(driver.get("missing.txt")).rejects.toThrow(/not found/);
  });

  it("should reject a path that escapes the directory", async () => {
    await expect(driver.get("../evil.txt")).rejects.toThrow(/escapes/);
  });

  it("should abort an in-flight upload and remove the partial file", async () => {
    const controller = new AbortController();
    let released!: () => void;
    const gate = new Promise<void>((resolve) => (released = resolve));

    const stream = new ReadableStream({
      async start(c) {
        c.enqueue(new TextEncoder().encode("chunk"));
        await gate; // keep the stream open mid-upload
        c.close();
      },
    });

    const upload = driver.upload(stream, {
      filename: "abort.txt",
      signal: controller.signal,
    });
    const errPromise = upload.catch((e) => e);

    setTimeout(() => controller.abort(), 20);
    const err = await errPromise;
    released();

    expect(err.name).toBe("AbortError");
    expect(readdirSync(tmpDir)).toHaveLength(0);
  });

  it("should report upload progress as bytes are written to disk", async () => {
    const content = "progress payload";
    const events: Array<{ bytes: number; total?: number; progress?: number }> = [];

    const result = await new FilewayClient({ driver }).upload(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(content));
          controller.close();
        },
      }),
      {
        filename: "progress.txt",
        size: content.length,
        onProgress: (p) => events.push(p),
      },
    );

    expect(result.size).toBe(content.length);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1]!;
    expect(last.bytes).toBe(content.length);
    expect(last.total).toBe(content.length);
    expect(last.progress).toBe(1);
  });
})
