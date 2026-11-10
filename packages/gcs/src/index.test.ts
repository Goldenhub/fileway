import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { FilewayClient, StorageError, ValidationError } from "@fileway/core";
import { GCSDriver } from "./index.js";
import { classifyGcsError } from "./errors.js";
import { sha256Hex, rfc3986 } from "./auth.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

const KiB = 1024;
const EMAIL = "uploader@proj.iam.gserviceaccount.com";
let PEM = "";
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  publicKey = pair.publicKey;
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let binary = "";
  for (const b of der) binary += String.fromCharCode(b);
  const b64 = btoa(binary).replace(/(.{64})/g, "$1\n");
  PEM = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
});

function tokenDriver(extra: Partial<ConstructorParameters<typeof GCSDriver>[0]> = {}) {
  return new GCSDriver({ bucket: "bkt", getAccessToken: async () => "tkn", ...extra });
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
  const [input, init] = mockFetch.mock.calls[i] as [string, RequestInit | undefined];
  return { url: new URL(String(input)), init: init ?? {}, headers: (init?.headers ?? {}) as Record<string, string> };
}

function objectJson(name: string, size: number, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ name, size: String(size), generation: "1", md5Hash: "abc==", etag: "CAE=", ...extra }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function gcsFailure(status: number, message: string) {
  return new Response(JSON.stringify({ error: { code: status, message } }), { status });
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function fromHex(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/../g) ?? [], (h) => parseInt(h, 16));
}

describe("configuration", () => {
  it("requires a bucket and some form of auth", () => {
    expect(() => new GCSDriver({ bucket: "" , getAccessToken: async () => "t" })).toThrow(StorageError);
    expect(() => new GCSDriver({ bucket: "b" })).toThrow(/credentials, serviceAccount or getAccessToken/);
    expect(() => new GCSDriver({ bucket: "b", serviceAccount: "{not json" })).toThrow(/not valid JSON/);
    expect(() => new GCSDriver({ bucket: "b", serviceAccount: { client_email: "", private_key: "" } })).toThrow(
      /client_email and private_key/,
    );
  });

  it("builds public URLs", async () => {
    await expect(tokenDriver().getUrl("a b/c.txt")).resolves.toBe("https://storage.googleapis.com/bkt/a%20b/c.txt");
    await expect(tokenDriver({ baseUrl: "https://cdn.example.com/" }).getUrl("x.txt")).resolves.toBe("https://cdn.example.com/x.txt");
  });
});

describe("service account auth", () => {
  it("exchanges a signed RS256 JWT for a token and caches it", async () => {
    mockFetch.mockImplementation(async (input: string) => {
      if (String(input).startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "ya29.token", expires_in: 3600 }));
      }
      return objectJson("x.txt", 1);
    });
    const driver = new GCSDriver({
      bucket: "bkt",
      serviceAccount: JSON.stringify({ client_email: EMAIL, private_key: PEM.replace(/\n/g, "\\n") }),
    });
    await Promise.all([driver.head("x.txt"), driver.head("y.txt")]);
    await driver.head("z.txt");

    const tokenCalls = mockFetch.mock.calls.filter(([u]) => String(u).includes("oauth2"));
    expect(tokenCalls).toHaveLength(1);
    const form = new URLSearchParams(String((tokenCalls[0]![1] as RequestInit).body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");

    const [header, claims, signature] = form.get("assertion")!.split(".") as [string, string, string];
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(header)))).toEqual({ alg: "RS256", typ: "JWT" });
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(claims)));
    expect(payload).toMatchObject({
      iss: EMAIL,
      aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/devstorage.read_write",
    });
    expect(payload.exp - payload.iat).toBe(3600);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      fromBase64Url(signature),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);

    const objectCall = mockFetch.mock.calls.find(([u]) => String(u).includes("/storage/v1/"));
    expect(((objectCall![1] as RequestInit).headers as Record<string, string>).authorization).toBe("Bearer ya29.token");
  });

  it("classifies a rejected key as auth-failed", async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":"invalid_grant"}', { status: 400 }));
    const driver = new GCSDriver({ bucket: "bkt", credentials: { clientEmail: EMAIL, privateKey: PEM } });
    await expect(driver.head("x")).rejects.toMatchObject({ code: "auth-failed" });
  });

  it("rejects PKCS #1 keys with a config error", async () => {
    const driver = new GCSDriver({
      bucket: "bkt",
      credentials: { clientEmail: EMAIL, privateKey: "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----" },
    });
    await expect(driver.head("x")).rejects.toMatchObject({ code: "config" });
  });
});

describe("upload", () => {
  it("sends a small file as one multipart/related request", async () => {
    mockFetch.mockResolvedValueOnce(objectJson("docs/inv_42.pdf", 5));
    const result = await tokenDriver().upload(body(5), {
      filename: "report.pdf",
      path: "docs",
      id: "inv_42",
      mimeType: "application/pdf",
      metadata: { owner: "ada" },
      size: 5,
    }, { uploadToken: "tok-1" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, init, headers } = call(0);
    expect(url.pathname).toBe("/upload/storage/v1/b/bkt/o");
    expect(url.searchParams.get("uploadType")).toBe("multipart");
    expect(headers.authorization).toBe("Bearer tkn");
    const boundary = headers["content-type"]!.match(/boundary=(.+)$/)![1]!;
    const text = new TextDecoder().decode(init.body as Uint8Array);
    const json = JSON.parse(text.split("\r\n\r\n")[1]!.split("\r\n")[0]!);
    expect(json).toEqual({
      name: "docs/inv_42.pdf",
      contentType: "application/pdf",
      metadata: { owner: "ada", "fileway-upload-token": "tok-1" },
    });
    expect(text).toContain("Content-Type: application/pdf\r\n\r\n\u0007\u0007\u0007\u0007\u0007\r\n");
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
    expect(result).toEqual({
      id: "inv_42",
      url: "https://storage.googleapis.com/bkt/docs/inv_42.pdf",
      path: "docs/inv_42.pdf",
      size: 5,
      meta: { bucket: "bkt", generation: "1", md5Hash: "abc==", etag: "CAE=" },
    });
  });

  it("uses a resumable session with 256 KiB aligned chunks for larger files", async () => {
    const session = "https://storage.googleapis.com/upload/storage/v1/b/bkt/o?uploadType=resumable&upload_id=U1";
    let offset = 0;
    mockFetch.mockImplementation(async (input: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 200, headers: { location: session } });
      const size = (init?.body as Uint8Array).byteLength;
      offset += size;
      const range = ((init?.headers ?? {}) as Record<string, string>)["content-range"]!;
      if (range.endsWith("/*")) return new Response(null, { status: 308, headers: { range: `bytes=0-${offset - 1}` } });
      return objectJson("big.bin", offset);
    });

    const total = 600 * KiB;
    const result = await tokenDriver({ chunkSize: 300 * KiB }).upload(body(total, 64 * KiB), {
      filename: "big.bin",
      mimeType: "video/mp4",
    }, { uploadToken: "tok" });

    expect(mockFetch).toHaveBeenCalledTimes(4);
    const start = call(0);
    expect(start.url.searchParams.get("uploadType")).toBe("resumable");
    expect(start.headers["x-upload-content-type"]).toBe("video/mp4");
    expect(JSON.parse(String(start.init.body)).metadata).toEqual({ "fileway-upload-token": "tok" });
    // chunkSize rounds down to 256 KiB.
    expect(call(1).headers["content-range"]).toBe(`bytes 0-${256 * KiB - 1}/*`);
    expect(call(2).headers["content-range"]).toBe(`bytes ${256 * KiB}-${512 * KiB - 1}/*`);
    expect(call(3).headers["content-range"]).toBe(`bytes ${512 * KiB}-${total - 1}/${total}`);
    expect(String(call(1).url)).toBe(session);
    expect(result.size).toBe(total);
  });

  it("resends the part of a chunk the server did not persist", async () => {
    const session = "https://storage.googleapis.com/upload/session/1";
    let puts = 0;
    mockFetch.mockImplementation(async (_input: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 200, headers: { location: session } });
      puts++;
      const range = ((init?.headers ?? {}) as Record<string, string>)["content-range"]!;
      if (puts === 1) return new Response(null, { status: 308, headers: { range: `bytes=0-${100 * KiB - 1}` } });
      if (range.endsWith("/*")) return new Response(null, { status: 308, headers: { range: `bytes=0-${256 * KiB - 1}` } });
      return objectJson("a.bin", 300 * KiB);
    });
    await tokenDriver({ chunkSize: 256 * KiB }).upload(body(300 * KiB), { filename: "a.bin" });
    expect(call(2).headers["content-range"]).toBe(`bytes ${100 * KiB}-${256 * KiB - 1}/*`);
    expect((call(2).init.body as Uint8Array).byteLength).toBe(156 * KiB);
  });

  it("finalizes an empty stream", async () => {
    mockFetch.mockResolvedValueOnce(objectJson("e.txt", 0));
    const result = await tokenDriver().upload(body(0), { filename: "e.txt" });
    expect(result.size).toBe(0);
  });

  it("rejects a size mismatch and cancels the session", async () => {
    mockFetch.mockImplementation(async (_input: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 200, headers: { location: "https://s/1" } });
      if (init?.method === "DELETE") return new Response(null, { status: 499 });
      return new Response(null, { status: 308, headers: { range: `bytes=0-${256 * KiB - 1}` } });
    });
    await expect(
      tokenDriver({ chunkSize: 256 * KiB }).upload(body(300 * KiB), { filename: "a.bin", size: 400 * KiB }),
    ).rejects.toThrow(ValidationError);
    expect(mockFetch.mock.calls.at(-1)![1]).toMatchObject({ method: "DELETE" });
  });

  it("enforces maxSizeBytes up front and while streaming", async () => {
    const driver = tokenDriver({ maxSizeBytes: 4 });
    await expect(driver.upload(body(10), { filename: "a", size: 10 })).rejects.toMatchObject({ code: "size-exceeded" });
    await expect(driver.upload(body(10, 2), { filename: "a" })).rejects.toMatchObject({ code: "size-exceeded" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("aborts mid-stream", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(10));
        setTimeout(() => controller.abort(), 5);
      },
    });
    await expect(tokenDriver().upload(stream, { filename: "a", signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("classifies errors", async () => {
    mockFetch.mockResolvedValueOnce(gcsFailure(404, "The specified bucket does not exist."));
    await expect(tokenDriver().upload(body(1), { filename: "a" })).rejects.toMatchObject({
      code: "bucket-not-found",
      statusCode: 404,
      provider: "gcs",
    });
    mockFetch.mockResolvedValueOnce(gcsFailure(403, "uploader does not have storage.objects.create access"));
    await expect(tokenDriver().upload(body(1), { filename: "a" })).rejects.toMatchObject({ code: "auth-failed" });
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(tokenDriver().upload(body(1), { filename: "a" })).rejects.toMatchObject({ code: "network" });
  });
});

describe("delete, get, head", () => {
  it("deletes, treating a missing object as success", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(tokenDriver().delete("docs/a b.txt")).resolves.toBeUndefined();
    expect(call(0).url.pathname).toBe("/storage/v1/b/bkt/o/docs%2Fa%20b.txt");
    mockFetch.mockResolvedValueOnce(gcsFailure(404, "No such object: bkt/docs/a b.txt"));
    await expect(tokenDriver().delete("docs/a b.txt")).resolves.toBeUndefined();
    mockFetch.mockResolvedValueOnce(gcsFailure(404, "The specified bucket does not exist."));
    await expect(tokenDriver().delete("x")).rejects.toMatchObject({ code: "bucket-not-found" });
  });

  it("passes the signal and classifies throttling", async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(async () => new Response("x"));
    await tokenDriver().get("a", { signal: controller.signal });
    await tokenDriver().delete("a", { signal: controller.signal });
    for (const [, init] of mockFetch.mock.calls) expect((init as RequestInit).signal).toBe(controller.signal);
    mockFetch.mockImplementation(async () => gcsFailure(429, "rateLimitExceeded"));
    await expect(tokenDriver().get("a")).rejects.toMatchObject({ code: "rate-limited" });
  });

  it("streams an object with alt=media", async () => {
    mockFetch.mockResolvedValueOnce(new Response("hello"));
    await expect(new Response(await tokenDriver().get("a.txt")).text()).resolves.toBe("hello");
    expect(call(0).url.searchParams.get("alt")).toBe("media");
  });

  it("heads an object with its upload token", async () => {
    mockFetch.mockResolvedValueOnce(
      objectJson("docs/inv_42.txt", 12, {
        contentType: "text/plain",
        updated: "2026-10-27T10:00:00.000Z",
        metadata: { "fileway-upload-token": "tok" },
      }),
    );
    await expect(tokenDriver().head("docs/inv_42.txt")).resolves.toEqual({
      id: "inv_42",
      url: "https://storage.googleapis.com/bkt/docs/inv_42.txt",
      path: "docs/inv_42.txt",
      size: 12,
      meta: { bucket: "bkt", generation: "1", md5Hash: "abc==", etag: "CAE=" },
      uploadToken: "tok",
      lastModified: new Date("2026-10-27T10:00:00Z"),
      contentType: "text/plain",
    });
    mockFetch.mockResolvedValueOnce(gcsFailure(404, "No such object: bkt/missing"));
    await expect(tokenDriver().head("missing")).resolves.toBeNull();
  });
});

describe("getPresignedUrl", () => {
  it("creates a V4 signed URL that verifies with the public key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T10:00:00.123Z"));
    try {
      const driver = new GCSDriver({ bucket: "bkt", credentials: { clientEmail: EMAIL, privateKey: PEM } });
      const signed = new URL(await driver.getPresignedUrl("docs/a b(1).txt", { expiresIn: 600 }));
      expect(signed.pathname).toBe("/bkt/docs/a%20b%281%29.txt");
      expect(signed.searchParams.get("X-Goog-Algorithm")).toBe("GOOG4-RSA-SHA256");
      expect(signed.searchParams.get("X-Goog-Credential")).toBe(`${EMAIL}/20261027/auto/storage/goog4_request`);
      expect(signed.searchParams.get("X-Goog-Date")).toBe("20261027T100000Z");
      expect(signed.searchParams.get("X-Goog-Expires")).toBe("600");

      const query = [...signed.searchParams]
        .filter(([k]) => k !== "X-Goog-Signature")
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
        .join("&");
      const canonical = ["GET", signed.pathname, query, "host:storage.googleapis.com\n", "host", "UNSIGNED-PAYLOAD"].join("\n");
      const stringToSign = ["GOOG4-RSA-SHA256", "20261027T100000Z", "20261027/auto/storage/goog4_request", await sha256Hex(canonical)].join("\n");
      const valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        fromHex(signed.searchParams.get("X-Goog-Signature")!),
        new TextEncoder().encode(stringToSign),
      );
      expect(valid).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("needs a key and a valid expiry", async () => {
    await expect(tokenDriver().getPresignedUrl("a")).rejects.toMatchObject({ code: "config" });
    const driver = new GCSDriver({ bucket: "bkt", credentials: { clientEmail: EMAIL, privateKey: PEM } });
    await expect(driver.getPresignedUrl("a", { expiresIn: 604801 })).rejects.toThrow(ValidationError);
  });
});

describe("classifyGcsError", () => {
  it("falls back to the HTTP status", () => {
    expect(classifyGcsError(401, "")).toBe("auth-failed");
    expect(classifyGcsError(413, "")).toBe("size-exceeded");
    expect(classifyGcsError(503, "")).toBe("provider-error");
    expect(classifyGcsError(404, "not json")).toBe("not-found");
  });
});

describe("with FilewayClient", () => {
  it("recovers a lost upload response without re-uploading", async () => {
    const stored = new Map<string, { size: number; token: string }>();
    let uploads = 0;
    mockFetch.mockImplementation(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === "POST") {
        uploads++;
        const text = new TextDecoder().decode(init.body as Uint8Array);
        const json = JSON.parse(text.split("\r\n\r\n")[1]!.split("\r\n")[0]!);
        stored.set(json.name, { size: 7, token: json.metadata["fileway-upload-token"] });
        throw new TypeError("fetch failed");
      }
      const name = decodeURIComponent(url.pathname.split("/o/")[1] ?? "");
      const object = stored.get(name);
      if (!object) return gcsFailure(404, `No such object: bkt/${name}`);
      return objectJson(name, object.size, { metadata: { "fileway-upload-token": object.token } });
    });

    const client = new FilewayClient({ driver: tokenDriver(), retry: { maxRetries: 3, baseDelayMs: 1, jitter: false } });
    const result = await client.upload(body(7), { filename: "a.bin", size: 7 });
    expect(uploads).toBe(1);
    expect(result.size).toBe(7);
  });

  it("reports upload status by id", async () => {
    const client = new FilewayClient({ driver: tokenDriver(), retry: { maxRetries: 0 } });
    mockFetch.mockResolvedValueOnce(gcsFailure(404, "No such object: bkt/docs/inv_42.pdf"));
    await expect(client.getUploadStatus("inv_42", { filename: "a.pdf", path: "docs" })).resolves.toEqual({ state: "missing" });
    expect(call(0).url.pathname).toBe("/storage/v1/b/bkt/o/docs%2Finv_42.pdf");
  });
});

describe("list, copy, move", () => {
  it("lists one level and pages with the page token", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [{ name: "photos/a.jpg", size: "3", updated: "2026-11-10T10:00:00.000Z", etag: "CAE=", contentType: "image/jpeg" }],
          prefixes: ["photos/2026/"],
          nextPageToken: "next-1",
        }),
      ),
    );
    const page = await tokenDriver().list({ prefix: "photos/", limit: 5 });
    const url = call(0).url;
    expect(url.pathname).toBe("/storage/v1/b/bkt/o");
    expect(url.searchParams.get("delimiter")).toBe("/");
    expect(url.searchParams.get("maxResults")).toBe("5");
    expect(page.objects).toEqual([
      { path: "photos/a.jpg", size: 3, lastModified: new Date("2026-11-10T10:00:00Z"), etag: "CAE=", contentType: "image/jpeg" },
    ]);
    expect(page.folders).toEqual(["photos/2026/"]);

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({})));
    await expect(tokenDriver().list({ recursive: true, cursor: page.cursor! })).resolves.toEqual({ objects: [], folders: [] });
    expect(call(1).url.searchParams.get("pageToken")).toBe("next-1");
    expect(call(1).url.searchParams.has("delimiter")).toBe(false);
  });

  it("copies with rewrite, looping until done, guarded by ifGenerationMatch=0", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ done: false, rewriteToken: "rt1" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ done: true })));
    await tokenDriver().copy("docs/a.pdf", "docs/b.pdf");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(call(0).url.pathname).toBe("/storage/v1/b/bkt/o/docs%2Fa.pdf/rewriteTo/b/bkt/o/docs%2Fb.pdf");
    expect(call(0).url.searchParams.get("ifGenerationMatch")).toBe("0");
    expect(call(1).url.searchParams.get("rewriteToken")).toBe("rt1");

    mockFetch.mockResolvedValueOnce(gcsFailure(412, "At least one of the pre-conditions you specified did not hold."));
    await expect(tokenDriver().copy("a", "b")).rejects.toMatchObject({ code: "conflict" });

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ done: true })));
    await tokenDriver().copy("a", "b", { overwrite: true });
    expect(call(3).url.searchParams.has("ifGenerationMatch")).toBe(false);
  });

  it("moves by copying, then deleting", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ done: true })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await tokenDriver().move("a.txt", "b.txt");
    expect(call(1).init.method).toBe("DELETE");
    expect(call(1).url.pathname).toBe("/storage/v1/b/bkt/o/a.txt");
  });
});

describe("range reads", () => {
  it("sends a Range header and declares range support", async () => {
    expect(tokenDriver().capabilities).toEqual({ range: true });
    mockFetch.mockResolvedValueOnce(new Response("abc", { status: 206 }));
    await tokenDriver().get("a.bin", { range: { start: 5 } });
    expect(call(0).headers.range).toBe("bytes=5-");
  });
});
