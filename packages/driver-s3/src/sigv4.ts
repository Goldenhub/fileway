import { ValidationError } from "@fileway/core";

const SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const STREAMING_AWS4_HMAC_SHA256_PAYLOAD = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD";

export function iso8601(date: Date): string {
  return date.toISOString().replace(/[:\-]|\.\d{3}/g, "");
}

export function dateStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return hex(new Uint8Array(hash));
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data as BufferSource));
}

async function deriveKey(secret: string, date: string, region: string, service: string): Promise<Uint8Array> {
  const kDate = await hmac(new TextEncoder().encode("AWS4" + secret), new TextEncoder().encode(date));
  const kRegion = await hmac(kDate, new TextEncoder().encode(region));
  const kService = await hmac(kRegion, new TextEncoder().encode(service));
  return hmac(kService, new TextEncoder().encode("aws4_request"));
}

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

interface SignatureParts {
  amzDate: string;
  scope: string;
  signedHeaders: string;
  signingKey: Uint8Array;
  signature: string;
}

/**
 * Builds the SigV4 canonical query string: every key and value URI-encoded,
 * sorted by key, joined with `&`. This is exactly the query string a client
 * sends on the wire, so it is reused for URL construction.
 */
export function buildCanonicalQueryString(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k] ?? "")}`)
    .join("&");
}

async function computeSignature(
  method: string,
  path: string,
  headers: Record<string, string>,
  bodyHash: string,
  cred: SigV4Credentials,
  date: Date,
  query?: Record<string, string>,
): Promise<SignatureParts> {
  const amzDate = iso8601(date);
  const dateStr = dateStamp(date);

  const allHeaders: Record<string, string> = {
    host: headers["host"] ?? "",
    "x-amz-content-sha256": bodyHash,
    "x-amz-date": amzDate,
    ...headers,
  };

  const sortedKeys = Object.keys(allHeaders).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k.toLowerCase()}:${allHeaders[k]!.trim()}\n`).join("");
  const signedHeaders = sortedKeys.map((k) => k.toLowerCase()).join(";");

  const canonicalQuery = buildCanonicalQueryString(query ?? {});
  const canonicalRequest = [method.toUpperCase(), path, canonicalQuery, canonicalHeaders, signedHeaders, bodyHash].join("\n");
  const canonicalHash = await sha256(canonicalRequest);

  const scope = `${dateStr}/${cred.region}/${cred.service}/aws4_request`;

  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, canonicalHash].join("\n");

  const signingKey = await deriveKey(cred.secretAccessKey, dateStr, cred.region, cred.service);
  const signature = hex(await hmac(signingKey, new TextEncoder().encode(stringToSign)));

  return { amzDate, scope, signedHeaders, signingKey, signature };
}

export async function sign(method: string, path: string, headers: Record<string, string>, bodyHash: string, cred: SigV4Credentials, date: Date, query?: Record<string, string>): Promise<Record<string, string>> {
  const { amzDate, scope, signedHeaders, signature } = await computeSignature(method, path, headers, bodyHash, cred, date, query);

  return {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": bodyHash,
    authorization: `AWS4-HMAC-SHA256 Credential=${cred.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export interface StreamingSignResult {
  headers: Record<string, string>;
  seedSignature: string;
  signingKey: Uint8Array;
  scope: string;
  amzDate: string;
}

export async function signStreamingRequest(
  method: string,
  path: string,
  headers: Record<string, string>,
  decodedContentLength: number,
  cred: SigV4Credentials,
  date: Date,
  query?: Record<string, string>,
): Promise<StreamingSignResult> {
  const { amzDate, scope, signedHeaders, signingKey, signature } = await computeSignature(
    method,
    path,
    {
      ...headers,
      "content-encoding": "aws-chunked",
      "x-amz-decoded-content-length": String(decodedContentLength),
    },
    STREAMING_AWS4_HMAC_SHA256_PAYLOAD,
    cred,
    date,
    query,
  );

  return {
    headers: {
      "content-encoding": "aws-chunked",
      "x-amz-decoded-content-length": String(decodedContentLength),
      "x-amz-content-sha256": STREAMING_AWS4_HMAC_SHA256_PAYLOAD,
      "x-amz-date": amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${cred.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    seedSignature: signature,
    signingKey,
    scope,
    amzDate,
  };
}

export interface ChunkSignResult {
  chunkSignature: string;
  nextSeed: string;
}

export async function signChunk(chunkData: Uint8Array, seedSignature: string, dateTime: string, scope: string, signingKey: Uint8Array): Promise<ChunkSignResult> {
  const chunkHash = await sha256(chunkData);
  const chunkStringToSign = ["AWS4-HMAC-SHA256-PAYLOAD", dateTime, scope, seedSignature, SHA256_EMPTY, chunkHash].join("\n");

  const chunkSignature = hex(await hmac(signingKey, new TextEncoder().encode(chunkStringToSign)));
  return { chunkSignature, nextSeed: chunkSignature };
}

/**
 * Wraps an input stream into an `aws-chunked` encoded body whose chunks are
 * individually HMAC-signed with a chained signature. Pull-based: the input is
 * only read as fast as the consumer requests, so the file never buffers in
 * memory.
 *
 * The stream errors (aborting the request) if the input length does not match
 * `expectedSize`, which is what the request's `x-amz-decoded-content-length`
 * claims.
 *
 * Runtime bodies swallow the error as a generic `fetch failed` rejection, so a
 * caller can pass `errorRef` to recover the underlying `ValidationError`.
 */
export function createStreamingBody(
  input: ReadableStream<Uint8Array>,
  expectedSize: number,
  seedSignature: string,
  dateTime: string,
  scope: string,
  signingKey: Uint8Array,
  errorRef?: { current?: Error },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const reader = input.getReader();
  let seed = seedSignature;
  let sentBytes = 0;
  let terminalSent = false;

  const fail = async (controller: ReadableStreamDefaultController<Uint8Array>, message: string) => {
    const error = new ValidationError(message);
    if (errorRef) errorRef.current = error;
    await reader.cancel().catch(() => {});
    controller.error(error);
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (terminalSent) return;

      const { done, value } = await reader.read();
      if (done) {
        if (sentBytes !== expectedSize) {
          await fail(controller, `stream ended after ${sentBytes} bytes, expected ${expectedSize}`);
          return;
        }
        // The terminal chunk gets its own signature: an extra signChunk over
        // an empty payload, chained from the last data chunk's signature.
        const { chunkSignature } = await signChunk(new Uint8Array(0), seed, dateTime, scope, signingKey);
        terminalSent = true;
        controller.enqueue(encoder.encode(`0;chunk-signature=${chunkSignature}\r\n\r\n`));
        controller.close();
        return;
      }

      sentBytes += value.byteLength;
      if (sentBytes > expectedSize) {
        await fail(controller, `stream exceeded expected size of ${expectedSize} bytes`);
        return;
      }

      const { chunkSignature, nextSeed } = await signChunk(value, seed, dateTime, scope, signingKey);
      controller.enqueue(encoder.encode(`${value.byteLength.toString(16)};chunk-signature=${chunkSignature}\r\n`));
      controller.enqueue(value);
      controller.enqueue(encoder.encode("\r\n"));
      seed = nextSeed;
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
