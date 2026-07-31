import { BetterPushClient } from "@betterpush/core";
import { LocalDriver } from "@betterpush/driver-local";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmpDir = mkdtempSync(join(tmpdir(), "bp-test-"));
const driver = new LocalDriver({ directory: tmpDir, maxSizeBytes: 1024 * 1024 });
const client = new BetterPushClient({ driver });

const content = "Hello, BetterPush!";
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode(content));
    controller.close();
  },
});

const result = await client.upload(stream, { filename: "hello.txt", path: "test-uploads" });

console.log("Upload result:");
console.log("  id:", result.id);
console.log("  url:", result.url);
console.log("  path:", result.path);
console.log("  size:", result.size, "bytes");
console.log("  meta:", JSON.stringify(result.meta));

const filePath = result.meta.localPath;
console.log("\nFile on disk:", filePath);
console.log("Content:", readFileSync(filePath, "utf-8"));

const url = await client.getUrl(result.path);
console.log("\nGenerated URL:", url);

const deleted = await client.delete(result.path);
console.log("Deleted:", deleted);
console.log("File gone:", !existsSync(filePath));

rmSync(tmpDir, { recursive: true, force: true });
console.log("\nTemp dir cleaned up. ✓");
