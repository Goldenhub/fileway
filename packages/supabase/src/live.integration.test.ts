import { describe, it, expect } from "vitest";
import { FilewayClient } from "@fileway/core";
import { SupabaseDriver } from "./index.js";

// Runs against a real project when these are set, e.g.:
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_KEY=<secret key> SUPABASE_BUCKET=test \
//     pnpm --filter @fileway/supabase test
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;
const bucket = process.env.SUPABASE_BUCKET;
const describeEnv = url && key && bucket ? describe : describe.skip;

function bytes(size: number, chunk = 256 * 1024): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= size) return controller.close();
      const n = Math.min(chunk, size - sent);
      controller.enqueue(new Uint8Array(n).map((_, i) => (sent + i) % 251));
      sent += n;
    },
  });
}

describeEnv("SupabaseDriver against Supabase Storage", () => {
  // Built lazily: a skipped suite still runs this body while collecting tests.
  const driver = url && key && bucket
    ? new SupabaseDriver({ url, key, bucket })
    : (undefined as unknown as SupabaseDriver);
  const prefix = `fileway-test-${Date.now()}`;

  it("uploads small, streamed and resumable objects and reads them back", async () => {
    const MiB = 1024 * 1024;
    const small = await driver.upload(bytes(1000), { filename: "small.txt", path: prefix, mimeType: "text/plain", size: 1000 }, { uploadToken: "t1" });
    const streamed = await driver.upload(bytes(7 * MiB), { filename: "streamed.bin", path: prefix }, { uploadToken: "t2" });
    const resumable = await driver.upload(bytes(13 * MiB), { filename: "tus.bin", path: prefix, size: 13 * MiB }, { uploadToken: "t3" });

    expect(await driver.head(small.path)).toMatchObject({ size: 1000, uploadToken: "t1", contentType: "text/plain" });
    expect(await driver.head(streamed.path)).toMatchObject({ size: 7 * MiB, uploadToken: "t2" });
    expect(await driver.head(resumable.path)).toMatchObject({ size: 13 * MiB, uploadToken: "t3" });

    const downloaded = new Uint8Array(await new Response(await driver.get(resumable.path)).arrayBuffer());
    expect(downloaded[9_999_999]).toBe(9_999_999 % 251);

    const res = await fetch(await driver.getPresignedUrl(small.path, { expiresIn: 60 }));
    expect(res.status).toBe(200);

    for (const r of [small, streamed, resumable]) await expect(driver.delete(r.path)).resolves.toBeUndefined();
    await expect(driver.head(small.path)).resolves.toBeNull();
  }, 120_000);

  it("reports upload status through FilewayClient", async () => {
    const client = new FilewayClient({ driver });
    const result = await client.upload(bytes(5), { filename: "s.txt", path: prefix, id: "inv_42" });
    await expect(client.getUploadStatus("inv_42", { filename: "s.txt", path: prefix })).resolves.toMatchObject({ state: "complete" });
    await driver.delete(result.path);
  }, 60_000);
});
