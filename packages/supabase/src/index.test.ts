import { describe, it, expect, vi, beforeEach } from "vitest";
import { FilewayClient, StorageError, ValidationError } from "@fileway/core";
import { SupabaseDriver } from "./index.js";
import { classifySupabaseError } from "./errors.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

const MiB = 1024 * 1024;
const API = "https://ref.supabase.co/storage/v1";

function makeDriver(extra: Partial<ConstructorParameters<typeof SupabaseDriver>[0]> = {}) {
  return new SupabaseDriver({ url: "https://ref.supabase.co/", key: "sb_secret_abc", bucket: "files", ...extra });
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
  return { url: String(input), init: init ?? {}, headers: (init?.headers ?? {}) as Record<string, string> };
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

function decodeBase64(value: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));
}

describe("configuration and auth", () => {
  it("requires url, key and bucket", () => {
    expect(() => new SupabaseDriver({ url: "", key: "k", bucket: "b" })).toThrow(StorageError);
  });

  it("sends new-style keys only as apikey", async () => {
    mockFetch.mockResolvedValueOnce(json({ size: 1 }));
    await makeDriver().head("a.txt");
    expect(call(0).headers).toEqual({ apikey: "sb_secret_abc" });
  });

  it("sends legacy JWT keys and user tokens as a bearer token", async () => {
    mockFetch.mockImplementation(async () => json({ size: 1 }));
    await makeDriver({ key: "eyJservice" }).head("a.txt");
    expect(call(0).headers).toEqual({ apikey: "eyJservice", authorization: "Bearer eyJservice" });
    await makeDriver({ key: "sb_publishable_x", accessToken: "eyJuser" }).head("a.txt");
    expect(call(1).headers).toEqual({ apikey: "sb_publishable_x", authorization: "Bearer eyJuser" });
  });

  it("builds public URLs", async () => {
    await expect(makeDriver().getUrl("a b/c.txt")).resolves.toBe(`${API}/object/public/files/a%20b/c.txt`);
    await expect(makeDriver({ baseUrl: "https://cdn.example.com/" }).getUrl("x.txt")).resolves.toBe("https://cdn.example.com/x.txt");
  });
});

describe("upload", () => {
  it("sends a small file as one upsert POST with metadata and token", async () => {
    mockFetch.mockResolvedValueOnce(json({ Key: "files/docs/inv_42.pdf" }, 200, { etag: '"e1"' }));
    const result = await makeDriver({ cacheControl: 60 }).upload(body(5), {
      filename: "report.pdf",
      path: "docs",
      id: "inv_42",
      mimeType: "application/pdf",
      metadata: { owner: "ada" },
      size: 5,
    }, { uploadToken: "tok-1" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, init, headers } = call(0);
    expect(url).toBe(`${API}/object/files/docs/inv_42.pdf`);
    expect(init.method).toBe("POST");
    expect(headers["x-upsert"]).toBe("true");
    expect(headers["content-type"]).toBe("application/pdf");
    expect(headers["cache-control"]).toBe("max-age=60");
    expect(JSON.parse(decodeBase64(headers["x-metadata"]!))).toEqual({ owner: "ada", "fileway-upload-token": "tok-1" });
    expect((init.body as Uint8Array).byteLength).toBe(5);
    expect(result).toEqual({
      id: "inv_42",
      url: `${API}/object/public/files/docs/inv_42.pdf`,
      path: "docs/inv_42.pdf",
      size: 5,
      meta: { bucket: "files", etag: '"e1"' },
    });
  });

  it("uses TUS with 6 MiB chunks for a known large size", async () => {
    let offset = 0;
    mockFetch.mockImplementation(async (_input: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 201, headers: { location: "/storage/v1/upload/resumable/abc" } });
      offset += (init?.body as Uint8Array).byteLength;
      return new Response(null, { status: 204, headers: { "upload-offset": String(offset) } });
    });

    const total = 13 * MiB;
    const result = await makeDriver().upload(body(total, 512 * 1024), {
      filename: "video.mp4",
      mimeType: "video/mp4",
      size: total,
    }, { uploadToken: "tok" });

    expect(mockFetch).toHaveBeenCalledTimes(4);
    const create = call(0);
    expect(create.url).toBe(`${API}/upload/resumable`);
    expect(create.headers["upload-length"]).toBe(String(total));
    expect(create.headers["x-upsert"]).toBe("true");
    expect(create.headers["tus-resumable"]).toBe("1.0.0");
    const meta = Object.fromEntries(
      create.headers["upload-metadata"]!.split(",").map((pair) => {
        const [k, v] = pair.split(" ") as [string, string];
        return [k, decodeBase64(v)];
      }),
    );
    expect(meta).toEqual({
      bucketName: "files",
      objectName: result.path,
      contentType: "video/mp4",
      cacheControl: "3600",
      metadata: JSON.stringify({ "fileway-upload-token": "tok" }),
    });

    const patches = [1, 2, 3].map(call);
    expect(patches.map((p) => p.url)).toEqual(Array(3).fill("https://ref.supabase.co/storage/v1/upload/resumable/abc"));
    expect(patches.map((p) => p.headers["upload-offset"])).toEqual(["0", String(6 * MiB), String(12 * MiB)]);
    expect(patches.map((p) => (p.init.body as Uint8Array).byteLength)).toEqual([6 * MiB, 6 * MiB, MiB]);
    expect(result.size).toBe(total);
  });

  it("resends the part of a TUS chunk the server did not store", async () => {
    let patches = 0;
    mockFetch.mockImplementation(async (_input: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 201, headers: { location: "https://x/u/1" } });
      patches++;
      const start = Number(((init?.headers ?? {}) as Record<string, string>)["upload-offset"]);
      const stored = patches === 1 ? MiB : (init?.body as Uint8Array).byteLength;
      return new Response(null, { status: 204, headers: { "upload-offset": String(start + stored) } });
    });
    await makeDriver().upload(body(7 * MiB), { filename: "a.bin", size: 7 * MiB });
    expect(call(2).headers["upload-offset"]).toBe(String(MiB));
    expect((call(2).init.body as Uint8Array).byteLength).toBe(5 * MiB);
  });

  it("streams an unknown size beyond one chunk in a single POST", async () => {
    let received = 0;
    mockFetch.mockImplementation(async (_input: string, init?: RequestInit) => {
      received = (await new Response(init?.body as ReadableStream).arrayBuffer()).byteLength;
      return json({ Key: "x" });
    });
    const result = await makeDriver().upload(body(9 * MiB, MiB), { filename: "a.bin" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(call(0).init.body).toBeInstanceOf(ReadableStream);
    expect(call(0).init).toMatchObject({ duplex: "half" });
    expect(received).toBe(9 * MiB);
    expect(result.size).toBe(9 * MiB);
  });

  it("enforces maxSizeBytes on a streamed body", async () => {
    mockFetch.mockImplementation(async (_input: string, init?: RequestInit) => {
      await new Response(init?.body as ReadableStream).arrayBuffer();
      return json({});
    });
    await expect(makeDriver({ maxSizeBytes: 7 * MiB }).upload(body(9 * MiB, MiB), { filename: "a.bin" })).rejects.toMatchObject({
      code: "size-exceeded",
    });
  });

  it("rejects size mismatches before storing anything", async () => {
    await expect(makeDriver().upload(body(3), { filename: "a", size: 5 })).rejects.toThrow(ValidationError);
    await expect(makeDriver().upload(body(7 * MiB, MiB), { filename: "a", size: 5 })).rejects.toThrow(ValidationError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("terminates the TUS upload when the stream is short", async () => {
    mockFetch.mockImplementation(async (_input: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 201, headers: { location: "https://x/u/1" } });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      const start = Number(((init?.headers ?? {}) as Record<string, string>)["upload-offset"]);
      return new Response(null, { status: 204, headers: { "upload-offset": String(start + (init?.body as Uint8Array).byteLength) } });
    });
    await expect(makeDriver().upload(body(7 * MiB), { filename: "a", size: 8 * MiB })).rejects.toThrow(ValidationError);
    expect(mockFetch.mock.calls.at(-1)![1]).toMatchObject({ method: "DELETE" });
  });

  it("enforces maxSizeBytes up front", async () => {
    await expect(makeDriver({ maxSizeBytes: 4 }).upload(body(10), { filename: "a", size: 10 })).rejects.toMatchObject({
      code: "size-exceeded",
    });
  });

  it("aborts mid-stream", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(10));
        setTimeout(() => controller.abort(), 5);
      },
    });
    await expect(makeDriver().upload(stream, { filename: "a", signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("classifies errors from the JSON body", async () => {
    mockFetch.mockResolvedValueOnce(json({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" }, 400));
    await expect(makeDriver().upload(body(1), { filename: "a" })).rejects.toMatchObject({
      code: "bucket-not-found",
      statusCode: 400,
      provider: "supabase",
    });
    mockFetch.mockResolvedValueOnce(
      json({ statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" }, 400),
    );
    await expect(makeDriver().upload(body(1), { filename: "a" })).rejects.toMatchObject({ code: "auth-failed" });
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(makeDriver().upload(body(1), { filename: "a" })).rejects.toMatchObject({ code: "network" });
  });
});

describe("delete, get, head, getPresignedUrl", () => {
  it("deletes by prefix, treating nothing removed as success", async () => {
    mockFetch.mockResolvedValueOnce(json([{ name: "a.txt" }]));
    await expect(makeDriver().delete("docs/a.txt")).resolves.toBeUndefined();
    const { url, init } = call(0);
    expect(url).toBe(`${API}/object/files`);
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({ prefixes: ["docs/a.txt"] });
    mockFetch.mockResolvedValueOnce(json([]));
    await expect(makeDriver().delete("docs/a.txt")).resolves.toBeUndefined();
  });

  it("passes the signal and classifies throttling", async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(async () => new Response("x"));
    await makeDriver().get("a", { signal: controller.signal });
    await makeDriver().head("a", { signal: controller.signal }).catch(() => {});
    for (const [, init] of mockFetch.mock.calls) expect((init as RequestInit).signal).toBe(controller.signal);
    mockFetch.mockImplementation(async () => json({ statusCode: "429", error: "too_many_requests", message: "Too Many Requests" }, 429));
    await expect(makeDriver().get("a")).rejects.toMatchObject({ code: "rate-limited" });
  });

  it("downloads through the authenticated route", async () => {
    mockFetch.mockResolvedValueOnce(new Response("hello"));
    await expect(new Response(await makeDriver().get("a b.txt")).text()).resolves.toBe("hello");
    expect(call(0).url).toBe(`${API}/object/authenticated/files/a%20b.txt`);
    mockFetch.mockResolvedValueOnce(json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400));
    await expect(makeDriver().get("x")).rejects.toMatchObject({ code: "not-found" });
  });

  it("heads an object with its upload token", async () => {
    mockFetch.mockResolvedValueOnce(
      json({
        name: "docs/inv_42.txt",
        size: 12,
        content_type: "text/plain",
        etag: '"e"',
        last_modified: "2026-10-27T10:00:00.000Z",
        metadata: { "fileway-upload-token": "tok" },
      }),
    );
    await expect(makeDriver().head("docs/inv_42.txt")).resolves.toEqual({
      id: "inv_42",
      url: `${API}/object/public/files/docs/inv_42.txt`,
      path: "docs/inv_42.txt",
      size: 12,
      meta: { bucket: "files", etag: '"e"' },
      uploadToken: "tok",
      lastModified: new Date("2026-10-27T10:00:00Z"),
      contentType: "text/plain",
    });
    expect(call(0).url).toBe(`${API}/object/info/files/docs/inv_42.txt`);
    mockFetch.mockResolvedValueOnce(json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400));
    await expect(makeDriver().head("missing")).resolves.toBeNull();
  });

  it("creates signed download URLs", async () => {
    mockFetch.mockResolvedValueOnce(json({ signedURL: "/object/sign/files/a.txt?token=abc" }));
    await expect(makeDriver().getPresignedUrl("a.txt", { expiresIn: 600 })).resolves.toBe(`${API}/object/sign/files/a.txt?token=abc`);
    expect(JSON.parse(String(call(0).init.body))).toEqual({ expiresIn: 600 });
    await expect(makeDriver().getPresignedUrl("a.txt", { expiresIn: 0 })).rejects.toThrow(ValidationError);
  });
});

describe("classifySupabaseError", () => {
  it("falls back to the HTTP status and text", () => {
    expect(classifySupabaseError(401, "")).toBe("auth-failed");
    expect(classifySupabaseError(413, "Payload Too Large")).toBe("size-exceeded");
    expect(classifySupabaseError(400, '{"statusCode":"413","error":"Payload too large","message":"The object exceeded the maximum allowed size"}')).toBe("size-exceeded");
    expect(classifySupabaseError(500, "boom")).toBe("provider-error");
    expect(classifySupabaseError(404, "")).toBe("not-found");
  });
});

describe("with FilewayClient", () => {
  it("recovers a lost upload response without re-uploading", async () => {
    const stored = new Map<string, { size: number; token: string }>();
    let uploads = 0;
    mockFetch.mockImplementation(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        uploads++;
        const headers = (init.headers ?? {}) as Record<string, string>;
        const meta = JSON.parse(decodeBase64(headers["x-metadata"]!));
        stored.set(url.split("/object/files/")[1]!, { size: (init.body as Uint8Array).byteLength, token: meta["fileway-upload-token"] });
        throw new TypeError("fetch failed");
      }
      const object = stored.get(url.split("/object/info/files/")[1]!);
      if (!object) return json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400);
      return json({ size: object.size, metadata: { "fileway-upload-token": object.token } });
    });

    const client = new FilewayClient({ driver: makeDriver(), retry: { maxRetries: 3, baseDelayMs: 1, jitter: false } });
    const result = await client.upload(body(7), { filename: "a.bin", size: 7 });
    expect(uploads).toBe(1);
    expect(result.size).toBe(7);
  });

  it("reports upload status by id", async () => {
    const client = new FilewayClient({ driver: makeDriver(), retry: { maxRetries: 0 } });
    mockFetch.mockResolvedValueOnce(json({ size: 3, metadata: {} }));
    await expect(client.getUploadStatus("inv_42", { filename: "a.pdf", path: "docs" })).resolves.toMatchObject({ state: "complete" });
    expect(call(0).url).toBe(`${API}/object/info/files/docs/inv_42.pdf`);
  });
});
