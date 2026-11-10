import { describe, it, expect } from "vitest";
import { FilewayClient } from "@fileway/core";
import { GCSDriver } from "./index.js";

// Runs against a real bucket when both variables are set, e.g.:
//   GCS_TEST_BUCKET=my-bucket GCS_SERVICE_ACCOUNT_JSON="$(cat key.json)" pnpm --filter @fileway/gcs test
const bucket = process.env.GCS_TEST_BUCKET;
const serviceAccount = process.env.GCS_SERVICE_ACCOUNT_JSON;
const describeEnv = bucket && serviceAccount ? describe : describe.skip;

function bytes(size: number, chunk = 64 * 1024): ReadableStream<Uint8Array> {
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

describeEnv("GCSDriver against Google Cloud Storage", () => {
  // Built lazily: a skipped suite still runs this body while collecting tests.
  const driver = bucket && serviceAccount
    ? new GCSDriver({ bucket, serviceAccount, chunkSize: 256 * 1024 })
    : (undefined as unknown as GCSDriver);
  const prefix = `fileway-test-${Date.now()}`;

  it("uploads small and resumable objects, reads them back and deletes them", async () => {
    const small = await driver.upload(bytes(1000), { filename: "small.txt", path: prefix, mimeType: "text/plain" }, { uploadToken: "t1" });
    const big = await driver.upload(bytes(700 * 1024), { filename: "big.bin", path: prefix }, { uploadToken: "t2" });

    expect((await driver.head(small.path))?.uploadToken).toBe("t1");
    expect((await driver.head(big.path))?.size).toBe(700 * 1024);
    const downloaded = new Uint8Array(await new Response(await driver.get(big.path)).arrayBuffer());
    expect(downloaded[123_456]).toBe(123_456 % 251);

    const res = await fetch(await driver.getPresignedUrl(small.path, { expiresIn: 60 }));
    expect(res.status).toBe(200);

    await expect(driver.delete(small.path)).resolves.toBeUndefined();
    await expect(driver.delete(big.path)).resolves.toBeUndefined();
    await expect(driver.head(small.path)).resolves.toBeNull();
  }, 60_000);

  it("lists, copies and moves objects", async () => {
    const a = await driver.upload(bytes(10), { filename: "a.txt", path: `${prefix}/lcm`, id: "a" });
    const page = await driver.list({ prefix: `${prefix}/lcm/` });
    expect(page.objects.map((o) => o.path)).toEqual([a.path]);
    await driver.copy(a.path, `${prefix}/lcm/b.txt`);
    await expect(driver.copy(a.path, `${prefix}/lcm/b.txt`)).rejects.toMatchObject({ code: "conflict" });
    await driver.move(`${prefix}/lcm/b.txt`, `${prefix}/lcm/c.txt`);
    expect((await driver.head(`${prefix}/lcm/c.txt`))?.size).toBe(10);
    await expect(driver.head(`${prefix}/lcm/b.txt`)).resolves.toBeNull();
    for (const p of [a.path, `${prefix}/lcm/c.txt`]) await driver.delete(p);
  }, 60_000);

  it("reports upload status through FilewayClient", async () => {
    const client = new FilewayClient({ driver });
    const result = await client.upload(bytes(5), { filename: "s.txt", path: prefix, id: "inv_42" });
    await expect(client.getUploadStatus("inv_42", { filename: "s.txt", path: prefix })).resolves.toMatchObject({ state: "complete" });
    await driver.delete(result.path);
  }, 60_000);
});
