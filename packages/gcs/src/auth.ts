// Google service account auth and V4 signed URLs, using only Web Crypto.
// https://developers.google.com/identity/protocols/oauth2/service-account
// https://cloud.google.com/storage/docs/access-control/signing-urls-manually

import { StorageError } from "@fileway/core";

export const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";
// Refresh this long before the token's stated expiry.
const REFRESH_MARGIN_MS = 60_000;

const encoder = new TextEncoder();

export interface ServiceAccountKey {
  clientEmail: string;
  privateKey: string;
  tokenUri?: string;
}

/** Imports a PEM `-----BEGIN PRIVATE KEY-----` (PKCS #8) key for RS256 signing. */
export function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = pem.replace(/\\n/g, "\n");
  if (normalized.includes("BEGIN RSA PRIVATE KEY")) {
    throw new StorageError(
      "config",
      "GCS private key must be PKCS #8 (BEGIN PRIVATE KEY), as in a service account JSON key file",
      { provider: "gcs" },
    );
  }
  const body = normalized.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  let der: Uint8Array<ArrayBuffer>;
  try {
    der = base64ToBytes(body);
  } catch (cause) {
    throw new StorageError("config", "GCS private key is not valid PEM", { provider: "gcs", cause: cause as Error });
  }
  return globalThis.crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function rsaSign(key: CryptoKey, message: string): Promise<Uint8Array> {
  const sig = await globalThis.crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(message));
  return new Uint8Array(sig);
}

/** A signed JWT asserting the service account, for the OAuth token exchange. */
export async function createAssertion(account: ServiceAccountKey, key: CryptoKey, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64Url(
    encoder.encode(
      JSON.stringify({
        iss: account.clientEmail,
        scope: SCOPE,
        aud: account.tokenUri ?? DEFAULT_TOKEN_URI,
        iat,
        exp: iat + 3600,
      }),
    ),
  );
  const signature = base64Url(await rsaSign(key, `${header}.${claims}`));
  return `${header}.${claims}.${signature}`;
}

/** Caches an OAuth access token for a service account and refreshes it shortly
 * before it expires; concurrent callers share one refresh. */
export class TokenSource {
  private key: Promise<CryptoKey> | undefined;
  private cached: { token: string; expiresAt: number } | undefined;
  private inflight: Promise<string> | undefined;

  constructor(private account: ServiceAccountKey) {}

  signingKey(): Promise<CryptoKey> {
    this.key ??= importPrivateKey(this.account.privateKey);
    return this.key;
  }

  async token(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt - REFRESH_MARGIN_MS) return this.cached.token;
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async refresh(): Promise<string> {
    const assertion = await createAssertion(this.account, await this.signingKey(), new Date());
    let res: Response;
    try {
      res = await fetch(this.account.tokenUri ?? DEFAULT_TOKEN_URI, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      });
    } catch (err) {
      const cause = err instanceof Error ? err : new Error(String(err));
      throw new StorageError("network", `gcs token request failed: ${cause.message}`, { provider: "gcs", cause });
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new StorageError(
        res.status >= 500 ? "provider-error" : "auth-failed",
        `GCS token request failed: ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`,
        { statusCode: res.status, provider: "gcs" },
      );
    }
    const data = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new StorageError("auth-failed", "GCS token response had no access_token", { provider: "gcs" });
    }
    this.cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return data.access_token;
  }
}

/** RFC 3986 encoding, as V4 signing requires (`encodeURIComponent` leaves `!'()*`). */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** A V4 signed GET URL (`GOOG4-RSA-SHA256`) for `objectName` in `bucket`. */
export async function signedReadUrl(args: {
  origin: string;
  bucket: string;
  objectName: string;
  clientEmail: string;
  key: CryptoKey;
  expiresIn: number;
  now: Date;
}): Promise<string> {
  const { origin, bucket, objectName, clientEmail, key, expiresIn, now } = args;
  const host = new URL(origin).host;
  const datetime = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = datetime.slice(0, 8);
  const scope = `${date}/auto/storage/goog4_request`;
  const path = `/${bucket}/${objectName.split("/").map(rfc3986).join("/")}`;
  const query: Record<string, string> = {
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": `${clientEmail}/${scope}`,
    "X-Goog-Date": datetime,
    "X-Goog-Expires": String(expiresIn),
    "X-Goog-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(query[k]!)}`)
    .join("&");
  const canonicalRequest = ["GET", path, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["GOOG4-RSA-SHA256", datetime, scope, await sha256Hex(canonicalRequest)].join("\n");
  const signature = toHex(await rsaSign(key, stringToSign));
  return `${origin}${path}?${canonicalQuery}&X-Goog-Signature=${signature}`;
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
