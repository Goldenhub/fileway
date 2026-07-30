import { BetterPushClient } from "@betterpush/core";
import { LocalDriver } from "./dist/index.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";

const tmpDir = mkdtempSync(join(tmpdir(), "betterpush-demo-"));
const driver = new LocalDriver({ directory: tmpDir, baseUrl: "http://localhost:8080" });
const client = new BetterPushClient({ driver });

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("Hello, BetterPush!"));
    controller.close();
  },
});

const result = await client.upload(stream, { filename: "hello.txt" });
console.log("Upload:", JSON.stringify(result, null, 2));
console.log("On disk:", existsSync(result.meta.localPath));
console.log("Content:", readFileSync(result.meta.localPath, "utf-8"));
console.log("Deleted:", await client.delete(result.path));
console.log("Gone:", existsSync(result.meta.localPath));
rmSync(tmpDir, { recursive: true, force: true });
