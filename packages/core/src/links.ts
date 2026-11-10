import { StorageError, isAbortError } from "./errors.js";
import { ValidationError } from "./validation.js";
import type {
  BaseDriver,
  ByteRange,
  GetOptions,
  LinksConfig,
  PluginRoute,
  TrackOptions,
  UploadOptions,
  UploadResult,
  VerifiedLink,
} from "./types.js";

// Internal: app-signed download and upload links (RFC 0004).

const encoder = new TextEncoder();
const VERSION = "1";
const HKDF_INFO = "fileway-links-v1";
const MIN_SECRET_BYTES = 32;
export const DEFAULT_MAX_EXPIRES_IN = 604800;

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml", heic: "image/heic",
  pdf: "application/pdf",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
  txt: "text/plain", csv: "text/csv", html: "text/html", htm: "text/html", css: "text/css",
  js: "text/javascript", mjs: "text/javascript", json: "application/json", xml: "application/xml",
  zip: "application/zip",
};

/** The content type for `path`'s extension, when it is a common one. */
export function mimeFromPath(path: string): string | undefined {
  const name = path.split("/").pop() ?? "";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return MIME[ext];
}

/** Images (except SVG), PDF, audio and video: types that cannot run script. */
export function isSafeInline(type: string, extra: string[] = []): boolean {
  const t = type.split(";")[0]!.trim().toLowerCase();
  if (extra.map((e) => e.toLowerCase()).includes(t)) return true;
  if (t === "image/svg+xml") return false;
  return t.startsWith("image/") || t.startsWith("audio/") || t.startsWith("video/") || t === "application/pdf";
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decodes and length-checks the secrets; throws `config` for bad ones. */
export function checkSecrets(secret: string | string[]): Uint8Array<ArrayBuffer>[] {
  const secrets = Array.isArray(secret) ? secret : [secret];
  if (secrets.length === 0) throw new StorageError("config", "links.secret needs at least one secret");
  return secrets.map((s) => {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = base64ToBytes(s);
    } catch {
      throw new StorageError("config", "links.secret must be base64 or base64url encoded");
    }
    if (bytes.byteLength < MIN_SECRET_BYTES) {
      throw new StorageError("config", `links.secret must decode to at least ${MIN_SECRET_BYTES} bytes`);
    }
    return bytes;
  });
}

/** HMAC keys derived from each secret with HKDF, so the raw secret is never the signing key. */
export async function deriveKeys(secrets: Uint8Array<ArrayBuffer>[]): Promise<CryptoKey[]> {
  return Promise.all(
    secrets.map(async (secret) => {
      const base = await globalThis.crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
      return globalThis.crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode(HKDF_INFO) },
        base,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        false,
        ["sign", "verify"],
      );
    }),
  );
}

async function sign(key: CryptoKey, fields: string[]): Promise<string> {
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(fields.join("\n")));
  return bytesToBase64Url(new Uint8Array(sig));
}

async function verify(keys: CryptoKey[], fields: string[], sig: string): Promise<boolean> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(sig);
  } catch {
    return false;
  }
  const data = encoder.encode(fields.join("\n"));
  for (const key of keys) {
    // Constant-time comparison inside Web Crypto.
    if (await globalThis.crypto.subtle.verify("HMAC", key, bytes, data)) return true;
  }
  return false;
}

const downloadFields = (path: string, exp: string, d: string, fn: string, id: string) => ["v1", "GET", path, exp, d, fn, id];
const uploadFields = (p: string, exp: string, fn: string, id: string, mt: string, max: string) =>
  ["v1", "PUT", p, exp, fn, id, mt, max];

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function signDownload(args: {
  key: CryptoKey;
  base: string;
  path: string;
  expires: number;
  disposition: "inline" | "attachment";
  filename?: string;
  id?: string;
}): Promise<string> {
  const exp = String(args.expires);
  const d = args.disposition === "inline" ? "i" : "a";
  const sig = await sign(args.key, downloadFields(args.path, exp, d, args.filename ?? "", args.id ?? ""));
  const query = new URLSearchParams({ v: VERSION, exp, d });
  if (args.filename) query.set("fn", args.filename);
  if (args.id) query.set("id", args.id);
  query.set("sig", sig);
  return `${args.base}/files/${encodePath(args.path)}?${query}`;
}

export async function signUpload(args: {
  key: CryptoKey;
  base: string;
  path?: string;
  filename: string;
  id: string;
  mimeType?: string;
  maxSize: number;
  expires: number;
}): Promise<string> {
  const exp = String(args.expires);
  const max = String(args.maxSize);
  const sig = await sign(args.key, uploadFields(args.path ?? "", exp, args.filename, args.id, args.mimeType ?? "", max));
  const query = new URLSearchParams({ v: VERSION, exp, fn: args.filename, id: args.id, max });
  if (args.path) query.set("p", args.path);
  if (args.mimeType) query.set("mt", args.mimeType);
  query.set("sig", sig);
  return `${args.base}/upload?${query}`;
}

/** Parses `Range: bytes=a-b` (one range). `null` = no usable header; `"invalid"` = 416. */
export function parseRange(header: string | null, size: number): ByteRange | null | "invalid" {
  if (!header) return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null; // multi-range or unknown units: serve the whole file
  const [, a, b] = match;
  if (a === "" && b === "") return "invalid";
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(a);
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  if (start >= size || end < start) return "invalid";
  return { start, end };
}

function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

const STATUS: Partial<Record<string, number>> = {
  validation: 400,
  "not-found": 404,
  conflict: 409,
  "size-exceeded": 413,
};

function errorResponse(status: number, code: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}

/** Maps a failure while serving a link to an HTTP response. */
function failure(err: unknown, cors: Record<string, string>): Response {
  if (isAbortError(err)) return errorResponse(499, "aborted", cors);
  if (err instanceof StorageError) return errorResponse(STATUS[err.code] ?? 502, err.code, cors);
  return errorResponse(500, "internal_error", cors);
}

export interface LinkDeps {
  driver: BaseDriver;
  config: LinksConfig;
  keys: () => Promise<CryptoKey[]>;
  get(path: string, options: GetOptions & TrackOptions): Promise<ReadableStream<Uint8Array>>;
  upload(stream: ReadableStream<Uint8Array>, options: UploadOptions & TrackOptions): Promise<UploadResult<Record<string, unknown>>>;
}

/**
 * Headers that stop served files from running script on the app's origin.
 * PDFs skip the CSP: Chrome renders them with an embedded viewer that a
 * `sandbox` or `default-src 'none'` policy blocks. PDF viewers do not run page
 * script on the origin, so `nosniff` is enough there.
 */
function securityHeaders(type: string): Record<string, string> {
  const t = type.split(";")[0]!.trim().toLowerCase();
  return {
    "x-content-type-options": "nosniff",
    ...(t === "application/pdf" ? {} : { "content-security-policy": "sandbox; default-src 'none'" }),
  };
}

function corsHeaders(config: LinksConfig, request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !config.cors?.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-expose-headers": "content-length, content-range, content-disposition, etag",
    vary: "origin",
  };
}

function expired(exp: string): boolean {
  const n = Number(exp);
  return !Number.isFinite(n) || n * 1000 < Date.now();
}

/** The built-in routes that serve app-signed links. */
export function linkRoutes(deps: LinkDeps): Record<string, PluginRoute> {
  const { config, driver } = deps;

  const download: PluginRoute = async (request, ctx) => {
    const cors = corsHeaders(config, request);
    const url = new URL(request.url);
    const q = url.searchParams;
    let path: string;
    try {
      path = decodeURIComponent(ctx.params.wildcard ?? "");
    } catch {
      return errorResponse(403, "forbidden", cors);
    }
    const exp = q.get("exp") ?? "";
    const d = q.get("d") ?? "";
    const fn = q.get("fn") ?? "";
    const id = q.get("id") ?? "";
    if (q.get("v") !== VERSION || !(d === "i" || d === "a") || path.split("/").includes("..")) {
      return errorResponse(403, "forbidden", cors);
    }
    if (!(await verify(await deps.keys(), downloadFields(path, exp, d, fn, id), q.get("sig") ?? ""))) {
      return errorResponse(403, "forbidden", cors);
    }
    if (expired(exp)) return errorResponse(403, "expired", { ...cors, "fileway-error": "expired" });
    const link: VerifiedLink = {
      method: "GET",
      path,
      expires: new Date(Number(exp) * 1000),
      disposition: d === "i" ? "inline" : "attachment",
      ...(fn ? { filename: fn } : {}),
      ...(id ? { id } : {}),
    };
    if (id && config.check && !(await config.check(link, request))) return errorResponse(403, "forbidden", cors);

    try {
      const object = driver.head ? await driver.head(path, { signal: request.signal }) : undefined;
      if (object === null) return errorResponse(404, "not-found", cors);
      const type = object?.contentType ?? mimeFromPath(path) ?? "application/octet-stream";
      // A stored type that can run script never opens inline, whatever the link says.
      const inline = link.disposition === "inline" && isSafeInline(type, config.inlineTypes);
      const remaining = Math.max(0, Number(exp) - Math.floor(Date.now() / 1000));
      const headers: Record<string, string> = {
        ...securityHeaders(type),
        ...cors,
        "content-type": type,
        "content-disposition": contentDisposition(inline ? "inline" : "attachment", fn || (path.split("/").pop() ?? "file")),
        "cache-control": `private, max-age=${Math.min(remaining, 300)}`,
        ...(object?.lastModified ? { "last-modified": object.lastModified.toUTCString() } : {}),
        ...(typeof object?.meta.etag === "string" ? { etag: object.meta.etag } : {}),
      };
      const size = object?.size;
      let range: ByteRange | undefined;
      if (size !== undefined && driver.capabilities?.range) {
        headers["accept-ranges"] = "bytes";
        const parsed = parseRange(request.headers.get("range"), size);
        if (parsed === "invalid") return errorResponse(416, "range-not-satisfiable", { ...cors, "content-range": `bytes */${size}` });
        if (parsed) range = parsed;
      }
      if (size !== undefined) {
        headers["content-length"] = String(range ? range.end! - range.start + 1 : size);
        if (range) headers["content-range"] = `bytes ${range.start}-${range.end}/${size}`;
      }
      const status = range ? 206 : 200;
      if (request.method === "HEAD") return new Response(null, { status, headers });

      const stream = await deps.get(path, {
        signal: request.signal,
        ...(range ? { range } : {}),
        actor: "link",
        ...(id ? { tags: { linkId: id } } : {}),
      });
      return new Response(stream, { status, headers });
    } catch (err) {
      return failure(err, cors);
    }
  };

  const upload: PluginRoute = async (request) => {
    const cors = corsHeaders(config, request);
    const q = new URL(request.url).searchParams;
    const exp = q.get("exp") ?? "";
    const fn = q.get("fn") ?? "";
    const id = q.get("id") ?? "";
    const p = q.get("p") ?? "";
    const mt = q.get("mt") ?? "";
    const max = q.get("max") ?? "";
    if (q.get("v") !== VERSION || !fn || !id) return errorResponse(403, "forbidden", cors);
    if (!(await verify(await deps.keys(), uploadFields(p, exp, fn, id, mt, max), q.get("sig") ?? ""))) {
      return errorResponse(403, "forbidden", cors);
    }
    if (expired(exp)) return errorResponse(403, "expired", { ...cors, "fileway-error": "expired" });
    const link: VerifiedLink = { method: "PUT", path: p, expires: new Date(Number(exp) * 1000), filename: fn, id };
    if (config.check && !(await config.check(link, request))) return errorResponse(403, "forbidden", cors);

    const maxSize = Number(max);
    const length = request.headers.get("content-length");
    const declared = length !== null && /^\d+$/.test(length) ? Number(length) : undefined;
    if (declared !== undefined && declared > maxSize) return errorResponse(413, "size-exceeded", cors);
    if (!request.body) return errorResponse(400, "validation", cors);

    // Count bytes as they arrive: a missing or false Content-Length cannot get past the limit.
    let seen = 0;
    const counted = request.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          seen += chunk.byteLength;
          if (seen > maxSize) {
            controller.error(new StorageError("size-exceeded", `upload exceeds the link's limit of ${maxSize} bytes`));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    try {
      const result = await deps.upload(counted, {
        filename: fn,
        id,
        ...(p ? { path: p } : {}),
        ...(mt ? { mimeType: mt } : {}),
        ...(declared !== undefined ? { size: declared } : {}),
        signal: request.signal,
        actor: "link",
        tags: { linkId: id },
      });
      return new Response(JSON.stringify({ id: result.id, path: result.path, size: result.size }), {
        status: 201,
        headers: { "content-type": "application/json", ...cors },
      });
    } catch (err) {
      return failure(err, cors);
    }
  };

  const preflight: PluginRoute = async (request) => {
    const cors = corsHeaders(config, request);
    if (!cors["access-control-allow-origin"]) return new Response(null, { status: 204 });
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "access-control-allow-methods": "GET, HEAD, PUT",
        "access-control-allow-headers": "content-type, range",
        "access-control-max-age": "600",
      },
    });
  };

  return {
    "GET /files/*": download,
    "HEAD /files/*": download,
    "OPTIONS /files/*": preflight,
    "PUT /upload": upload,
    "OPTIONS /upload": preflight,
  };
}

/** Throws a `ValidationError` unless `expiresIn` is an integer from 1 to `max`. */
export function checkExpiresIn(expiresIn: number, max: number): void {
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > max) {
    throw new ValidationError(`expiresIn must be an integer from 1 to ${max} seconds`);
  }
}
