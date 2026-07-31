const SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

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

export async function sign(method: string, path: string, headers: Record<string, string>, bodyHash: string, cred: SigV4Credentials, date: Date): Promise<Record<string, string>> {
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

  const canonicalRequest = [method.toUpperCase(), path, "", canonicalHeaders, signedHeaders, bodyHash].join("\n");

  const canonicalHash = await sha256(canonicalRequest);

  const scope = `${dateStr}/${cred.region}/${cred.service}/aws4_request`;

  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, canonicalHash].join("\n");

  const signingKey = await deriveKey(cred.secretAccessKey, dateStr, cred.region, cred.service);
  const signature = hex(await hmac(signingKey, new TextEncoder().encode(stringToSign)));

  return {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": bodyHash,
    authorization: `AWS4-HMAC-SHA256 Credential=${cred.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
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

export async function signChunkedBody(chunks: Uint8Array[], totalSize: number, seedSignature: string, date: Date, region: string, service: string, secretAccessKey: string): Promise<{ body: ReadableStream<Uint8Array>; headers: Record<string, string> }> {
  const amzDate = iso8601(date);
  const dateStr = dateStamp(date);
  const scope = `${dateStr}/${region}/${service}/aws4_request`;
  const signingKey = await deriveKey(secretAccessKey, dateStr, region, service);

  let chunkIndex = 0;
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let seed = seedSignature;
      for (const chunk of chunks) {
        const { chunkSignature, nextSeed } = await signChunk(chunk, seed, amzDate, scope, signingKey);
        const header = encoder.encode(`${chunk.byteLength.toString(16)};chunk-signature=${chunkSignature}\r\n`);
        controller.enqueue(header);
        controller.enqueue(chunk);
        controller.enqueue(encoder.encode("\r\n"));
        seed = nextSeed;
      }
      const trailer = encoder.encode(`0;chunk-signature=${seed}\r\n\r\n`);
      controller.enqueue(trailer);
      controller.close();
    },
  });

  const headers: Record<string, string> = {
    "content-encoding": "aws-chunked",
    "x-amz-decoded-content-length": String(totalSize),
    "x-amz-content-sha256": "STREAMING-AWS4-HMAC-SHA256-PAYLOAD",
    "x-amz-date": amzDate,
  };

  return { body, headers };
}
