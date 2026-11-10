import { describe, it, expect, vi, beforeEach } from "vitest";
import { FilewayClient, StorageError, ValidationError } from "@fileway/core";
import { AzureDriver } from "./index.js";
import { classifyAzureError, parseConnectionString } from "./internal.js";
import { buildStringToSign, hmacBase64, signRequest } from "./sharedkey.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

const ACCOUNT = "devstoreaccount1";
const KEY = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
const MiB = 1024 * 1024;

function makeDriver(extra: Partial<ConstructorParameters<typeof AzureDriver>[0]> = {}) {
  return new AzureDriver({ container: "files", accountName: "acct", accountKey: KEY, ...extra });
}

function body(size: number, chunk = size): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= size) return controller.close();
      const n = Math.min(chunk, size - sent);
      controller.enqueue(new Uint8Array(n).fill(7));
      sent += n;
    },
  });
}

function call(i: number) {
  const [input, init] = mockFetch.mock.calls[i] as [URL, RequestInit];
  return { url: new URL(String(input)), init, headers: (init.headers ?? {}) as Record<string, string> };
}

function created(etag = '"0x1"') {
  return new Response(null, { status: 201, headers: { etag } });
}

function failure(status: number, code: string) {
  return new Response(`<?xml version="1.0"?><Error><Code>${code}</Code></Error>`, {
    status,
    headers: { "x-ms-error-code": code },
  });
}

describe("Shared Key signing", () => {
  it("builds the canonical string-to-sign", () => {
    const url = new URL("http://127.0.0.1:10000/devstoreaccount1/files/a%20b/c.txt?comp=block&blockid=QUJD%2B%2F%3D");
    const s = buildStringToSign(
      "put",
      url,
      ACCOUNT,
      {
        "Content-Type": "text/plain",
        "x-ms-version": "2023-11-03",
        "X-MS-Date": "Tue, 27 Oct 2026 10:00:00 GMT",
        "x-ms-meta-owner": "  ada   lovelace ",
      },
      11,
    );
    expect(s).toBe(
      [
        "PUT",
        "",
        "",
        "11",
        "",
        "text/plain",
        "",
        "",
        "",
        "",
        "",
        "",
        "x-ms-date:Tue, 27 Oct 2026 10:00:00 GMT\n" +
          "x-ms-meta-owner:ada lovelace\n" +
          "x-ms-version:2023-11-03\n" +
          "/devstoreaccount1/devstoreaccount1/files/a%20b/c.txt\nblockid:QUJD+/=\ncomp:block",
      ].join("\n"),
    );
  });

  it("signs an empty body with an empty content-length", () => {
    const s = buildStringToSign("GET", new URL("https://acct.blob.core.windows.net/c/x"), "acct", {}, 0);
    expect(s.split("\n")[3]).toBe("");
  });

  it("produces a SharedKey authorization header over that string", async () => {
    const url = new URL("https://acct.blob.core.windows.net/files/x.txt");
    const now = new Date("2026-10-27T10:00:00Z");
    const headers = await signRequest("DELETE", url, "acct", KEY, {}, undefined, now);
    expect(headers["x-ms-date"]).toBe("Tue, 27 Oct 2026 10:00:00 GMT");
    const expected = await hmacBase64(KEY, buildStringToSign("DELETE", url, "acct", headers, undefined));
    expect(headers.authorization).toBe(`SharedKey acct:${expected}`);
  });
});

describe("configuration", () => {
  it("parses Azurite's development connection string", () => {
    expect(parseConnectionString("UseDevelopmentStorage=true")).toEqual({
      accountName: ACCOUNT,
      accountKey: KEY,
      endpoint: "http://127.0.0.1:10000/devstoreaccount1",
    });
  });

  it("parses an account connection string, keeping '=' inside the key", () => {
    const cs = "DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=abc==;EndpointSuffix=core.windows.net";
    expect(parseConnectionString(cs)).toEqual({
      accountName: "acct",
      accountKey: "abc==",
      endpoint: "https://acct.blob.core.windows.net",
    });
  });

  it("parses a SAS connection string", () => {
    const cs = "BlobEndpoint=https://acct.blob.core.windows.net/;SharedAccessSignature=sv=2023&sig=abc";
    expect(parseConnectionString(cs)).toEqual({
      endpoint: "https://acct.blob.core.windows.net/",
      sasToken: "sv=2023&sig=abc",
    });
  });

  it("throws config errors for missing container or credentials", () => {
    expect(() => new AzureDriver({ container: "", accountName: "a", accountKey: KEY })).toThrow(StorageError);
    expect(() => new AzureDriver({ container: "c", accountName: "a" })).toThrow(/accountKey, sasToken/);
    expect(() => new AzureDriver({ container: "c", accountKey: KEY })).toThrow(/accountName/);
  });

  it("takes the account name from an Azurite endpoint", async () => {
    const driver = new AzureDriver({ container: "c", connectionString: "UseDevelopmentStorage=true" });
    await expect(driver.getUrl("a/b c.txt")).resolves.toBe("http://127.0.0.1:10000/devstoreaccount1/c/a/b%20c.txt");
  });
});

describe("upload", () => {
  it("sends a small file as one Put Blob with type, metadata and token", async () => {
    mockFetch.mockResolvedValueOnce(created('"etag-1"'));
    const driver = makeDriver();
    const result = await driver.upload(body(5), {
      filename: "report.pdf",
      path: "docs",
      id: "inv_42",
      mimeType: "application/pdf",
      metadata: { owner: "ada" },
      size: 5,
    }, { uploadToken: "tok-1" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, init, headers } = call(0);
    expect(init.method).toBe("PUT");
    expect(url.href).toBe("https://acct.blob.core.windows.net/files/docs/inv_42.pdf");
    expect(headers["x-ms-blob-type"]).toBe("BlockBlob");
    expect(headers["content-type"]).toBe("application/pdf");
    expect(headers["x-ms-meta-owner"]).toBe("ada");
    expect(headers["x-ms-meta-fileway_upload_token"]).toBe("tok-1");
    expect(headers.authorization).toMatch(/^SharedKey acct:/);
    expect((init.body as Uint8Array).byteLength).toBe(5);
    expect(result).toEqual({
      id: "inv_42",
      url: "https://acct.blob.core.windows.net/files/docs/inv_42.pdf",
      path: "docs/inv_42.pdf",
      size: 5,
      meta: { container: "files", etag: '"etag-1"' },
    });
  });

  it("stages blocks and commits a block list for larger files", async () => {
    mockFetch.mockImplementation(async () => created('"final"'));
    const driver = makeDriver({ blockSize: MiB });
    const result = await driver.upload(body(Math.floor(2.5 * MiB), 64 * 1024), {
      filename: "big.bin",
      mimeType: "video/mp4",
    }, { uploadToken: "tok" });

    expect(mockFetch).toHaveBeenCalledTimes(4);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { url, init } = call(i);
      expect(url.searchParams.get("comp")).toBe("block");
      ids.push(url.searchParams.get("blockid")!);
      expect((init.body as Uint8Array).byteLength).toBe(i < 2 ? MiB : MiB / 2);
    }
    expect(new Set(ids.map((id) => id.length)).size).toBe(1);

    const commit = call(3);
    expect(commit.url.searchParams.get("comp")).toBe("blocklist");
    expect(commit.headers["x-ms-blob-content-type"]).toBe("video/mp4");
    expect(commit.headers["x-ms-meta-fileway_upload_token"]).toBe("tok");
    const xml = new TextDecoder().decode(commit.init.body as Uint8Array);
    expect(xml).toBe(
      `<?xml version="1.0" encoding="utf-8"?><BlockList>${ids.map((id) => `<Latest>${id}</Latest>`).join("")}</BlockList>`,
    );
    expect(result.size).toBe(Math.floor(2.5 * MiB));
    expect(result.meta.etag).toBe('"final"');
  });

  it("uploads an empty stream as an empty blob", async () => {
    mockFetch.mockResolvedValueOnce(created());
    const result = await makeDriver().upload(body(0), { filename: "empty.txt" });
    expect(result.size).toBe(0);
    expect((call(0).init.body as Uint8Array).byteLength).toBe(0);
  });

  it("rejects a stream shorter than the declared size", async () => {
    await expect(makeDriver().upload(body(3), { filename: "a.txt", size: 5 })).rejects.toThrow(ValidationError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("enforces maxSizeBytes up front and while streaming", async () => {
    const driver = makeDriver({ maxSizeBytes: 4 });
    await expect(driver.upload(body(10), { filename: "a.txt", size: 10 })).rejects.toMatchObject({ code: "size-exceeded" });
    await expect(driver.upload(body(10, 2), { filename: "a.txt" })).rejects.toMatchObject({ code: "size-exceeded" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects metadata keys Azure cannot store", async () => {
    await expect(makeDriver().upload(body(1), { filename: "a.txt", metadata: { "user-id": "1" } })).rejects.toThrow(
      ValidationError,
    );
  });

  it("aborts mid-stream", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(10));
        setTimeout(() => controller.abort(), 5);
      },
    });
    await expect(makeDriver().upload(stream, { filename: "a.txt", signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("classifies service errors", async () => {
    mockFetch.mockResolvedValueOnce(failure(404, "ContainerNotFound"));
    await expect(makeDriver().upload(body(1), { filename: "a.txt" })).rejects.toMatchObject({
      code: "bucket-not-found",
      statusCode: 404,
      provider: "azure",
    });
    mockFetch.mockResolvedValueOnce(failure(403, "AuthenticationFailed"));
    await expect(makeDriver().upload(body(1), { filename: "a.txt" })).rejects.toMatchObject({ code: "auth-failed" });
  });

  it("wraps network failures as network errors", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(makeDriver().upload(body(1), { filename: "a.txt" })).rejects.toMatchObject({ code: "network" });
  });
});

describe("SAS auth", () => {
  it("appends the SAS token instead of signing", async () => {
    mockFetch.mockResolvedValueOnce(created());
    const driver = new AzureDriver({ container: "files", accountName: "acct", sasToken: "?sv=2023-11-03&sig=abc%2B" });
    await driver.upload(body(1), { filename: "a.txt", id: "x" });
    const { url, headers } = call(0);
    expect(url.searchParams.get("sv")).toBe("2023-11-03");
    expect(url.searchParams.get("sig")).toBe("abc+");
    expect(headers.authorization).toBeUndefined();
    await expect(driver.getPresignedUrl("x.txt")).rejects.toMatchObject({ code: "config" });
  });
});

describe("delete, get, head, isPending", () => {
  it("deletes, treating a missing blob as success", async () => {
    const driver = makeDriver();
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 202 }));
    await expect(driver.delete("a.txt")).resolves.toBeUndefined();
    expect(call(0).init.method).toBe("DELETE");
    mockFetch.mockResolvedValueOnce(failure(404, "BlobNotFound"));
    await expect(driver.delete("a.txt")).resolves.toBeUndefined();
    mockFetch.mockResolvedValueOnce(failure(404, "ContainerNotFound"));
    await expect(driver.delete("a.txt")).rejects.toMatchObject({ code: "bucket-not-found" });
  });

  it("passes the signal and classifies throttling", async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(async () => new Response("x"));
    await makeDriver().get("a", { signal: controller.signal });
    await makeDriver().head("a", { signal: controller.signal });
    for (const [, init] of mockFetch.mock.calls) expect((init as RequestInit).signal).toBe(controller.signal);
    mockFetch.mockImplementation(async () => failure(503, "ServerBusy"));
    await expect(makeDriver().get("a")).rejects.toMatchObject({ code: "rate-limited", statusCode: 503 });
  });

  it("streams a blob and classifies a missing one", async () => {
    const driver = makeDriver();
    mockFetch.mockResolvedValueOnce(new Response("hello"));
    await expect(new Response(await driver.get("a.txt")).text()).resolves.toBe("hello");
    mockFetch.mockResolvedValueOnce(failure(404, "BlobNotFound"));
    await expect(driver.get("a.txt")).rejects.toMatchObject({ code: "not-found" });
  });

  it("heads a blob with its upload token", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: {
          "content-length": "12",
          "content-type": "text/plain",
          etag: '"e"',
          "last-modified": "Tue, 27 Oct 2026 10:00:00 GMT",
          "x-ms-meta-fileway_upload_token": "tok",
        },
      }),
    );
    const object = await makeDriver().head("docs/inv_42.txt");
    expect(object).toEqual({
      id: "inv_42",
      url: "https://acct.blob.core.windows.net/files/docs/inv_42.txt",
      path: "docs/inv_42.txt",
      size: 12,
      meta: { container: "files", etag: '"e"' },
      uploadToken: "tok",
      lastModified: new Date("2026-10-27T10:00:00Z"),
      contentType: "text/plain",
    });
    expect(call(0).init.method).toBe("HEAD");

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404, headers: { "x-ms-error-code": "BlobNotFound" } }));
    await expect(makeDriver().head("missing.txt")).resolves.toBeNull();
  });

  it("reports staged but uncommitted blocks as pending", async () => {
    const driver = makeDriver();
    mockFetch.mockResolvedValueOnce(
      new Response(
        "<BlockList><CommittedBlocks /><UncommittedBlocks><Block><Name>QQ==</Name><Size>4</Size></Block></UncommittedBlocks></BlockList>",
      ),
    );
    await expect(driver.isPending("a.txt")).resolves.toBe(true);
    expect(call(0).url.searchParams.get("blocklisttype")).toBe("uncommitted");

    mockFetch.mockResolvedValueOnce(new Response("<BlockList><CommittedBlocks /><UncommittedBlocks /></BlockList>"));
    await expect(driver.isPending("a.txt")).resolves.toBe(false);

    mockFetch.mockResolvedValueOnce(failure(404, "BlobNotFound"));
    await expect(driver.isPending("a.txt")).resolves.toBe(false);
  });
});

describe("getPresignedUrl", () => {
  it("creates a read-only service SAS", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T10:00:00.123Z"));
    try {
      const url = new URL(await makeDriver().getPresignedUrl("docs/a b.txt", { expiresIn: 600 }));
      expect(url.origin + url.pathname).toBe("https://acct.blob.core.windows.net/files/docs/a%20b.txt");
      expect(url.searchParams.get("sp")).toBe("r");
      expect(url.searchParams.get("sr")).toBe("b");
      expect(url.searchParams.get("se")).toBe("2026-10-27T10:10:00Z");
      const stringToSign = [
        "r", "", "2026-10-27T10:10:00Z", "/blob/acct/files/docs/a b.txt", "", "", "",
        url.searchParams.get("sv"), "b", "", "", "", "", "", "", "",
      ].join("\n");
      expect(url.searchParams.get("sig")).toBe(await hmacBase64(KEY, stringToSign));
    } finally {
      vi.useRealTimers();
    }
  });

  it("validates expiresIn", async () => {
    await expect(makeDriver().getPresignedUrl("a.txt", { expiresIn: 0 })).rejects.toThrow(ValidationError);
  });
});

describe("classifyAzureError", () => {
  it("falls back to the HTTP status", () => {
    expect(classifyAzureError(403, undefined)).toBe("auth-failed");
    expect(classifyAzureError(413, undefined)).toBe("size-exceeded");
    expect(classifyAzureError(500, "InternalError")).toBe("provider-error");
    expect(classifyAzureError(400, "RequestBodyTooLarge")).toBe("size-exceeded");
  });
});

describe("with FilewayClient", () => {
  it("recovers a lost Put Blob response without re-uploading", async () => {
    const stored = new Map<string, { size: number; token: string | undefined }>();
    let puts = 0;
    mockFetch.mockImplementation(async (input: URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (init?.method === "PUT") {
        puts++;
        stored.set(url.pathname, {
          size: (init.body as Uint8Array).byteLength,
          token: headers["x-ms-meta-fileway_upload_token"],
        });
        throw new TypeError("fetch failed");
      }
      if (init?.method === "HEAD") {
        const object = stored.get(url.pathname);
        if (!object) return new Response(null, { status: 404, headers: { "x-ms-error-code": "BlobNotFound" } });
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": String(object.size),
            ...(object.token ? { "x-ms-meta-fileway_upload_token": object.token } : {}),
          },
        });
      }
      return new Response(null, { status: 500 });
    });

    const client = new FilewayClient({ driver: makeDriver(), retry: { maxRetries: 3, baseDelayMs: 1, jitter: false } });
    const result = await client.upload(body(7), { filename: "a.bin", size: 7 });
    expect(puts).toBe(1);
    expect(result.size).toBe(7);
  });

  it("reports upload status by id", async () => {
    const client = new FilewayClient({ driver: makeDriver(), retry: { maxRetries: 0 } });
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 404, headers: { "x-ms-error-code": "BlobNotFound" } }))
      .mockResolvedValueOnce(new Response("<BlockList><UncommittedBlocks><Block><Name>QQ==</Name></Block></UncommittedBlocks></BlockList>"));
    const status = await client.getUploadStatus("inv_42", { filename: "a.pdf", path: "docs" });
    expect(status.state).toBe("pending");
    expect(call(0).url.pathname).toBe("/files/docs/inv_42.pdf");
  });
});

describe("list, copy, move", () => {
  it("lists one level with List Blobs", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        `<?xml version="1.0" encoding="utf-8"?><EnumerationResults><Blobs>` +
          `<Blob><Name>photos/a &amp; b.jpg</Name><Properties><Last-Modified>Tue, 10 Nov 2026 10:00:00 GMT</Last-Modified><Etag>0x1</Etag><Content-Length>3</Content-Length><Content-Type>image/jpeg</Content-Type></Properties></Blob>` +
          `<BlobPrefix><Name>photos/2026/</Name></BlobPrefix></Blobs><NextMarker>m2</NextMarker></EnumerationResults>`,
      ),
    );
    const page = await makeDriver().list({ prefix: "photos/", limit: 2 });
    const { url, headers } = call(0);
    expect(url.pathname).toBe("/files");
    expect(url.searchParams.get("comp")).toBe("list");
    expect(url.searchParams.get("delimiter")).toBe("/");
    expect(url.searchParams.get("maxresults")).toBe("2");
    expect(headers.authorization).toMatch(/^SharedKey acct:/);
    expect(page).toEqual({
      objects: [{ path: "photos/a & b.jpg", size: 3, lastModified: new Date("2026-11-10T10:00:00Z"), etag: "0x1", contentType: "image/jpeg" }],
      folders: ["photos/2026/"],
      cursor: expect.any(String),
    });

    mockFetch.mockResolvedValueOnce(new Response("<EnumerationResults><Blobs></Blobs><NextMarker /></EnumerationResults>"));
    await expect(makeDriver().list({ recursive: true, cursor: page.cursor! })).resolves.toEqual({ objects: [], folders: [] });
    expect(call(1).url.searchParams.get("marker")).toBe("m2");
    expect(call(1).url.searchParams.has("delimiter")).toBe(false);
  });

  it("copies with x-ms-copy-source and If-None-Match, waiting for pending copies", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 202, headers: { "x-ms-copy-status": "pending" } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { "x-ms-copy-status": "success" } }));
    await makeDriver().copy("docs/a b.txt", "docs/c.txt");
    const { url, headers, init } = call(0);
    expect(init.method).toBe("PUT");
    expect(url.pathname).toBe("/files/docs/c.txt");
    expect(headers["x-ms-copy-source"]).toBe("https://acct.blob.core.windows.net/files/docs/a%20b.txt");
    expect(headers["if-none-match"]).toBe("*");
    expect(call(1).init.method).toBe("HEAD");
  });

  it("maps an existing destination to conflict and a missing source to not-found", async () => {
    mockFetch.mockResolvedValueOnce(failure(409, "BlobAlreadyExists"));
    await expect(makeDriver().copy("a", "b")).rejects.toMatchObject({ code: "conflict" });
    mockFetch.mockResolvedValueOnce(failure(404, "CannotVerifyCopySource"));
    await expect(makeDriver().copy("a", "b", { overwrite: true })).rejects.toMatchObject({ code: "not-found" });
    expect(call(1).headers["if-none-match"]).toBeUndefined();
  });

  it("reports a failed background copy", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 202, headers: { "x-ms-copy-status": "pending" } }))
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { "x-ms-copy-status": "failed", "x-ms-copy-status-description": "500 InternalError" } }),
      );
    await expect(makeDriver().copy("a", "b")).rejects.toThrow(/copy failed: 500 InternalError/);
  });

  it("appends the SAS token to the copy source with SAS auth", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 202, headers: { "x-ms-copy-status": "success" } }));
    const driver = new AzureDriver({ container: "files", accountName: "acct", sasToken: "sv=2023&sig=abc" });
    await driver.copy("a.txt", "b.txt");
    const source = new URL(call(0).headers["x-ms-copy-source"]!);
    expect(source.searchParams.get("sig")).toBe("abc");
  });

  it("moves by copying, then deleting", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 202, headers: { "x-ms-copy-status": "success" } }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await makeDriver().move("a.txt", "b.txt");
    expect(call(1).init.method).toBe("DELETE");
    expect(call(1).url.pathname).toBe("/files/a.txt");
  });
});

describe("range reads", () => {
  it("sends a signed Range header and declares range support", async () => {
    expect(makeDriver({ maxSizeBytes: 9 }).capabilities).toEqual({ range: true, maxUploadBytes: 9 });
    mockFetch.mockResolvedValueOnce(new Response("abc", { status: 206 }));
    await makeDriver().get("a.bin", { range: { start: 0, end: 2 } });
    expect(call(0).headers.range).toBe("bytes=0-2");
    expect(call(0).headers.authorization).toMatch(/^SharedKey /);
  });
});
