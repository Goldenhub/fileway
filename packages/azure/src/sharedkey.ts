// Azure Storage Shared Key and service SAS signing, using only Web Crypto.
// https://learn.microsoft.com/rest/api/storageservices/authorize-with-shared-key
// https://learn.microsoft.com/rest/api/storageservices/create-service-sas

export const SERVICE_VERSION = "2023-11-03";

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(accountKey: string): Promise<CryptoKey> {
  let key = keyCache.get(accountKey);
  if (!key) {
    key = globalThis.crypto.subtle.importKey(
      "raw",
      base64ToBytes(accountKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    keyCache.set(accountKey, key);
  }
  return key;
}

/** Base64 HMAC-SHA256 of `message` with the base64-encoded account key. */
export async function hmacBase64(accountKey: string, message: string): Promise<string> {
  const key = await importKey(accountKey);
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToBase64(new Uint8Array(sig));
}

/**
 * The Shared Key string-to-sign for a request. `headers` are the request
 * headers (any case); `contentLength` is the body size in bytes (0 or
 * undefined signs as an empty value, as the service requires since 2015-02-21).
 */
export function buildStringToSign(
  method: string,
  url: URL,
  accountName: string,
  headers: Record<string, string>,
  contentLength: number | undefined,
): string {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  const h = (name: string) => lower[name] ?? "";

  const canonicalHeaders = Object.keys(lower)
    .filter((k) => k.startsWith("x-ms-"))
    .sort()
    .map((k) => `${k}:${(lower[k] ?? "").replace(/\s+/g, " ").trim()}\n`)
    .join("");

  // Query parameters: lowercase names, sorted, decoded values joined by commas.
  const params = new Map<string, string[]>();
  for (const [k, v] of url.searchParams) {
    const name = k.toLowerCase();
    params.set(name, [...(params.get(name) ?? []), v]);
  }
  const canonicalQuery = [...params.keys()]
    .sort()
    .map((k) => `\n${k}:${(params.get(k) ?? []).sort().join(",")}`)
    .join("");
  const canonicalResource = `/${accountName}${url.pathname}${canonicalQuery}`;

  return [
    method.toUpperCase(),
    h("content-encoding"),
    h("content-language"),
    contentLength ? String(contentLength) : "",
    h("content-md5"),
    h("content-type"),
    h("date"),
    h("if-modified-since"),
    h("if-match"),
    h("if-none-match"),
    h("if-unmodified-since"),
    h("range"),
    canonicalHeaders + canonicalResource,
  ].join("\n");
}

/** `x-ms-date`, `x-ms-version` and `Authorization: SharedKey` headers for a request. */
export async function signRequest(
  method: string,
  url: URL,
  accountName: string,
  accountKey: string,
  headers: Record<string, string>,
  contentLength: number | undefined,
  now: Date = new Date(),
): Promise<Record<string, string>> {
  const signed = {
    ...headers,
    "x-ms-date": now.toUTCString(),
    "x-ms-version": SERVICE_VERSION,
  };
  const stringToSign = buildStringToSign(method, url, accountName, signed, contentLength);
  const signature = await hmacBase64(accountKey, stringToSign);
  return { ...signed, authorization: `SharedKey ${accountName}:${signature}` };
}

/**
 * Query string for a read-only service SAS on one blob. `blobName` is the raw
 * (unencoded) blob name; `expiry` is when the link stops working.
 */
export async function blobReadSas(
  accountName: string,
  accountKey: string,
  container: string,
  blobName: string,
  expiry: Date,
): Promise<string> {
  const se = expiry.toISOString().replace(/\.\d{3}Z$/, "Z");
  const fields = {
    sp: "r",
    st: "",
    se,
    resource: `/blob/${accountName}/${container}/${blobName}`,
    si: "",
    sip: "",
    spr: "",
    sv: SERVICE_VERSION,
    sr: "b",
    snapshot: "",
    ses: "",
    rscc: "",
    rscd: "",
    rsce: "",
    rscl: "",
    rsct: "",
  };
  const signature = await hmacBase64(accountKey, Object.values(fields).join("\n"));
  const query = new URLSearchParams({ sv: SERVICE_VERSION, se, sr: "b", sp: "r", sig: signature });
  return query.toString();
}

export function base64ToBytes(value: string) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
