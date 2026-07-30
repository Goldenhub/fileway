import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
})
