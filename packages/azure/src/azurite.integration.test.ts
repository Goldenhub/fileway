import { describe, it, expect, beforeAll } from "vitest";
import { FilewayClient } from "@fileway/core";
import { AzureDriver } from "./index.js";
import { signRequest } from "./sharedkey.js";

// Runs against a local Azurite (`RUN_AZURITE_TESTS=1`), e.g.:
//   docker run -p 10000:10000 mcr.microsoft.com/azure-storage/azurite \
//     azurite-blob --blobHost 0.0.0.0 --skipApiVersionCheck
const enabled = process.env.RUN_AZURITE_TESTS === "1";
const describeEnv = enabled ? describe : describe.skip;

const ACCOUNT = "devstoreaccount1";
const KEY = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
const ENDPOINT = process.env.AZURITE_ENDPOINT ?? "http://127.0.0.1:10000/devstoreaccount1";
const CONTAINER = `fileway-test-${Date.now()}`;

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

describeEnv("AzureDriver against Azurite", () => {
  const driver = new AzureDriver({ container: CONTAINER, accountName: ACCOUNT, accountKey: KEY, endpoint: ENDPOINT, blockSize: 1024 * 1024 });

  beforeAll(async () => {
    const url = new URL(`${ENDPOINT}/${CONTAINER}?restype=container`);
    const headers = await signRequest("PUT", url, ACCOUNT, KEY, {}, undefined);
    const res = await fetch(url, { method: "PUT", headers });
    if (!res.ok && res.status !== 409) throw new Error(`create container failed: ${res.status} ${await res.text()}`);
  });

  it("uploads, heads, downloads and deletes a small blob", async () => {
    const result = await driver.upload(bytes(1000), {
      filename: "small.txt",
      path: "docs",
      mimeType: "text/plain",
      metadata: { owner: "ada" },
    }, { uploadToken: "tok-small" });
    expect(result.size).toBe(1000);

    const object = await driver.head(result.path);
    expect(object?.size).toBe(1000);
    expect(object?.contentType).toBe("text/plain");
    expect(object?.uploadToken).toBe("tok-small");

    const downloaded = new Uint8Array(await new Response(await driver.get(result.path)).arrayBuffer());
    expect(downloaded.byteLength).toBe(1000);
    expect(downloaded[300]).toBe(300 % 251);

    await expect(driver.delete(result.path)).resolves.toBeUndefined();
    await expect(driver.head(result.path)).resolves.toBeNull();
    // Deleting again is not an error.
    await expect(driver.delete(result.path)).resolves.toBeUndefined();
  });

  it("uploads a multi-block blob of unknown size", async () => {
    const size = Math.floor(2.5 * 1024 * 1024);
    const result = await driver.upload(bytes(size), { filename: "big.bin", mimeType: "application/zip" }, { uploadToken: "tok-big" });
    const object = await driver.head(result.path);
    expect(object?.size).toBe(size);
    expect(object?.contentType).toBe("application/zip");
    expect(object?.uploadToken).toBe("tok-big");
    await expect(driver.isPending(result.path)).resolves.toBe(false);
  });

  it("reports staged but uncommitted blocks as pending", async () => {
    const path = "pending/half.bin";
    await expect(driver.isPending(path)).resolves.toBe(false);
    const url = new URL(`${ENDPOINT}/${CONTAINER}/pending/half.bin?comp=block&blockid=${encodeURIComponent(btoa("block-0"))}`);
    const body = new Uint8Array(16);
    const headers = await signRequest("PUT", url, ACCOUNT, KEY, {}, body.byteLength);
    const res = await fetch(url, { method: "PUT", headers, body });
    expect(res.status).toBe(201);
    await expect(driver.isPending(path)).resolves.toBe(true);
    await expect(driver.head(path)).resolves.toBeNull();
  });

  it("serves a presigned URL without credentials", async () => {
    const result = await driver.upload(bytes(10), { filename: "shared.txt" });
    const res = await fetch(await driver.getPresignedUrl(result.path, { expiresIn: 60 }));
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(10);
  });

  it("reports upload status through FilewayClient", async () => {
    const client = new FilewayClient({ driver });
    await client.upload(bytes(5), { filename: "status.txt", id: "inv_42" });
    const status = await client.getUploadStatus("inv_42", { filename: "status.txt" });
    expect(status.state).toBe("complete");
    const missing = await client.getUploadStatus("nope", { filename: "status.txt" });
    expect(missing.state).toBe("missing");
  });

  it("classifies a missing container", async () => {
    const other = new AzureDriver({ container: "does-not-exist", accountName: ACCOUNT, accountKey: KEY, endpoint: ENDPOINT });
    await expect(other.upload(bytes(1), { filename: "a.txt" })).rejects.toMatchObject({ code: "bucket-not-found" });
  });
});
