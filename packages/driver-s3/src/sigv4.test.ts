import { describe, it, expect } from "vitest";
import { buildCanonicalQueryString, createStreamingBody, sign, signChunk, signStreamingRequest } from "./sigv4.js";

describe("buildCanonicalQueryString", () => {
  const cred = {
    accessKeyId: "AKID",
    secretAccessKey: "secret",
    region: "us-east-1",
    service: "s3",
  };
  const date = new Date("2026-07-31T12:00:00.000Z");

  it("sorts keys and URI-encodes keys and values", () => {
    expect(buildCanonicalQueryString({ z: "1", a: "hello world" })).toBe("a=hello%20world&z=1");
  });

  it("emits an empty value for subresource markers like uploads", () => {
    expect(buildCanonicalQueryString({ uploads: "" })).toBe("uploads=");
  });

  it("encodes reserved characters in values", () => {
    expect(buildCanonicalQueryString({ uploadId: "abc/def=1" })).toBe("uploadId=abc%2Fdef%3D1");
  });

  it("signs a request with the query string folded into the canonical request", async () => {
    const withQuery = await sign(
      "POST",
      "/bucket/key",
      { host: "s3.example.com" },
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      cred,
      date,
      { uploads: "" },
    );
    const withoutQuery = await sign(
      "POST",
      "/bucket/key",
      { host: "s3.example.com" },
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      cred,
      date,
    );

    expect(withQuery.authorization).toBeDefined();
    expect(withQuery.authorization).not.toBe(withoutQuery.authorization);
  });
});

describe("createStreamingBody", () => {
  const cred = {
    accessKeyId: "AKID",
    secretAccessKey: "secret",
    region: "us-east-1",
    service: "s3",
  };
  const date = new Date("2026-07-31T12:00:00.000Z");

  async function signedStreamingBody(input: ReadableStream<Uint8Array>, size: number) {
    const { seedSignature, signingKey, scope, amzDate } = await signStreamingRequest(
      "PUT",
      "/bucket/key",
      { host: "s3.example.com" },
      size,
      cred,
      date,
    );
    const body = createStreamingBody(input, size, seedSignature, amzDate, scope, signingKey);
    return { body, signingKey, scope, amzDate };
  }

  async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    let total = 0;
    for (const c of chunks) total += c.byteLength;
    const all = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      all.set(c, off);
      off += c.byteLength;
    }
    return all;
  }

  async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    while (true) {
      const { done } = await reader.read();
      if (done) return;
    }
  }

  function payload(...sizes: number[]): Uint8Array {
    const out: number[] = [];
    for (const s of sizes) out.push(...Array(s).fill(65));
    return new Uint8Array(out);
  }

  it("frames each chunk and signs it with a chained signature", async () => {
    const p = payload(3, 5);
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(p.subarray(0, 3));
        controller.enqueue(p.subarray(3, 8));
        controller.close();
      },
    });

    const { body, signingKey, scope, amzDate } = await signedStreamingBody(input, p.byteLength);
    const bytes = await collect(body);
    const text = new TextDecoder().decode(bytes);

    expect(text).toMatch(/^3;chunk-signature=[0-9a-f]{64}\r\nAAA\r\n/);
    expect(text).toMatch(/5;chunk-signature=[0-9a-f]{64}\r\nAAAAA\r\n/);
    expect(text).toMatch(/0;chunk-signature=[0-9a-f]{64}\r\n\r\n$/);

    const first = text.match(/^3;chunk-signature=([0-9a-f]{64})/)?.[1];
    const second = text.match(/5;chunk-signature=([0-9a-f]{64})/)?.[1];
    const terminal = text.match(/0;chunk-signature=([0-9a-f]{64})/)?.[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(terminal).toBeDefined();

    // The terminal chunk is an extra signChunk over an empty payload, chained
    // from the last data chunk's signature — not a copy of it.
    const expectedTerminal = (
      await signChunk(new Uint8Array(0), second!, amzDate, scope, signingKey)
    ).chunkSignature;
    expect(terminal).toBe(expectedTerminal);
    expect(terminal).not.toBe(second);
  });

  it("streams an empty file (size 0) as a bare terminal chunk", async () => {
    const { body } = await signedStreamingBody(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
      0,
    );
    const bytes = await collect(body);
    expect(new TextDecoder().decode(bytes)).toMatch(/^0;chunk-signature=[0-9a-f]{64}\r\n\r\n$/);
  });

  it("errors when the stream is shorter than the declared size", async () => {
    const { body } = await signedStreamingBody(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      }),
      10,
    );
    const reader = body.getReader();
    await expect(drain(reader)).rejects.toThrow("expected 10");
  });

  it("errors when the stream exceeds the declared size", async () => {
    const { body } = await signedStreamingBody(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      2,
    );
    const reader = body.getReader();
    await expect(drain(reader)).rejects.toThrow("exceeded expected size");
  });
});
