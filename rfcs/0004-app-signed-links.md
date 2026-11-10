# RFC 0004: App-signed links

- **Status:** Draft
- **Target:** `@fileway/core` 1.1 (additive)
- **Depends on:** the request handler from [RFC 0002](./0002-infra-plugin.md). Used by `LocalDriver`, [`@fileway/webdav`](./0003-webdav-driver.md), and Fileway Infrastructure's `link` and `upload-url` routes.

## Summary

Some storage cannot make signed URLs: local disks, network disks behind `LocalDriver`, and WebDAV servers. This RFC lets the **app** make them instead. `client.getPresignedUrl()` returns a link to the app's own Fileway handler, signed with a secret only the app knows and valid until it expires. When the link is opened, the handler checks the signature and streams the file from the driver. The same mechanism provides signed **upload** links.

```ts
const client = new FilewayClient({
  driver: new LocalDriver({ directory: "/mnt/office-nas/uploads" }),
  links: {
    secret: process.env.FILEWAY_LINK_SECRET,     // 32+ random bytes, base64
    baseUrl: "https://files.example.com/fileway", // where client.handler is mounted
  },
});

const url = await client.getPresignedUrl("reports/q3.pdf", { expiresIn: 600 });
// https://files.example.com/fileway/files/reports/q3.pdf?v=1&exp=1794270000&sig=...
```

## Motivation

- Without links, files on disks and WebDAV can be read only by code with storage access. They cannot be put in an `<img>`, previewed in the dashboard, or shared with a teammate.
- Fileway Infrastructure needs one way to open and share any file, whatever the driver (RFC 0002 `link` route), and a way to upload from the dashboard (RFC 0002 open question 3).
- The app already holds the storage credentials, so it is the right place to sign. Fileway's servers never sign, never see the secret, and never carry the bytes.

## Configuration

```ts
export interface LinksConfig {
  /**
   * Signing secret(s), each at least 32 bytes (base64 or base64url).
   * The first signs new links; all of them verify, so a secret can be rotated
   * without breaking links that are still valid.
   */
  secret: string | string[];
  /** Public URL where `client.handler` is mounted. Links are built from it. */
  baseUrl: string;
  /**
   * "fallback" (default): use app-signed links only when the driver has no
   * native presigned URLs. "always": use them for every driver, for example
   * to keep bucket URLs private or to log every download.
   */
  mode?: "fallback" | "always";
  /** Longest allowed `expiresIn`, in seconds. Default 604800 (7 days). */
  maxExpiresIn?: number;
  /**
   * Called before serving a link that carries an `id`. Return false to refuse
   * it (revoked share, download limit reached). Infrastructure plugs in here.
   */
  check?: (link: VerifiedLink, request: Request) => boolean | Promise<boolean>;
}
```

Without `links`, `getPresignedUrl` on a driver that lacks it keeps throwing `config`, as today.

## Download links

### Client API

```ts
client.getPresignedUrl(path, {
  expiresIn?: number,                         // default 3600
  disposition?: "inline" | "attachment",      // default "attachment", see Security
  filename?: string,                          // download name; default: last path segment
  id?: string,                                // optional link id, passed to `check`
  signal?: AbortSignal,
});
```

### URL format

```
{baseUrl}/files/{path, encoded per segment}?v=1&exp={unix seconds}&sig={base64url}[&d=i|a][&fn=...][&id=...]
```

### Signature

- Key: HKDF-SHA256 from the secret with info `"fileway-links-v1"`, so the link key never equals the raw secret and cannot collide with other uses of it.
- Signed string, one field per line, every field always present (empty when unset):

```
v1
GET
{path, decoded and normalized}
{exp}
{disposition}
{filename}
{id}
```

- `sig` is the full 32-byte HMAC-SHA256, base64url. Verification uses `crypto.subtle.verify`, which compares in constant time, and tries each configured secret in order.
- Everything that changes what is served is signed. Changing the path, extending `exp`, or switching to inline breaks the signature.

### Serving (`GET` and `HEAD {baseUrl}/files/*`)

1. Parse and validate the path with the core path rules (no `..`, no null bytes). Reject unknown `v`.
2. Check `exp` against the clock, then the signature, then `check` when the link has an `id`. Any failure returns `403` with a generic body; an expired link says so (`fileway-error: expired`) because that leaks nothing.
3. `stat` the file for headers, then `get` it with the request's `signal`, so a closed connection stops reading from disk or WebDAV.
4. Respond with the stream and `Content-Type`, `Content-Length`, `ETag`, `Last-Modified`, `Content-Disposition` (RFC 6266, with `filename*` for non-ASCII names), `Cache-Control: private, max-age={min(remaining, 300)}`, and the security headers below.
5. Emit a `get` event with `actor: "link"` and the link `id`, so downloads through links appear in the audit log.

### Range requests

Video and audio previews need `Range` to seek. `BaseDriver.get` gains an optional option:

```ts
get(path, options?: OperationOptions & { range?: { start: number; end?: number } })
```

Drivers that support it declare it (`capabilities.range = true`) and return only those bytes: `LocalDriver` through `createReadStream({ start, end })`, WebDAV and every cloud driver through the HTTP `Range` header. The handler answers `206 Partial Content` when the driver supports ranges, and a full `200` otherwise, which HTTP allows. One range per request; multi-range requests get the full file.

## Upload links

### Client API

```ts
client.getPresignedUploadUrl({
  filename: string,
  path?: string,
  id?: string,             // default: a new UUID, returned so the caller can track it
  mimeType?: string,
  maxSize?: number,        // bytes; default: the driver's maxSizeBytes, else 5 GiB
  expiresIn?: number,      // default 900
}): Promise<{ url: string; method: "PUT"; headers: Record<string, string>; id: string }>
```

When the driver has native presigned uploads (a follow-up for S3, GCS and Azure), those are used in `"fallback"` mode. Otherwise the link points at the app.

### Signature and serving

- The signed string uses `PUT` and adds `filename`, `path`, `id`, `mimeType` and `maxSize`. The uploader cannot choose a different name, folder, type or size limit.
- `PUT {baseUrl}/upload?...` checks the link as above, then rejects the request up front if `Content-Length` exceeds `maxSize`, and passes `request.body` to `client.upload` with the signed `filename`, `path`, `id` and `mimeType`. The size is enforced again while streaming, so a missing or false `Content-Length` cannot get around it.
- One link, one object: the signed `id` fixes the stored path (`pathFor`), and a second upload with the same link overwrites the same object rather than creating new ones. Combined with a short expiry, that bounds what a leaked link can do.
- Middleware, plugins (including Infrastructure's upload protection) and events run exactly as for any upload.
- Responses: `201` with `{ id, path, size }`, `403` for a bad link, `413` for too large, and the mapped status for storage errors.
- CORS: the handler answers `OPTIONS` for `/upload` and `/files/*` with the origins listed in `links.cors?: string[]` (none by default), so browsers on other origins can use the links only when allowed.

## Security

- **Stored XSS is the main risk.** A link serves user-uploaded content from the app's own origin. An HTML or SVG file opened inline there could run script with the app's cookies. Defenses, all on by default:
  - `disposition` defaults to `attachment`;
  - `inline` is refused for active types (`text/html`, `image/svg+xml`, `application/xhtml+xml`, `text/xml`, `application/javascript`) unless the app opts in per type;
  - every response carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox; default-src 'none'`;
  - the docs strongly recommend mounting the handler on a separate host (`files.example.com`) that has no session cookies, as the example above does.
- **No revocation by default.** Links are stateless. Expiry, `id` plus `check` (for share links that must be revocable), and secret rotation (which revokes every outstanding link) are the tools. The docs say this plainly.
- **Secret handling:** at least 32 bytes, enforced at construction (`config` error). Never logged, never sent in events, never sent to Fileway Infrastructure.
- **Clock:** links are checked on the same server that signed them, so no skew allowance is needed. Multiple servers must share the secret and a reasonably correct clock.
- **Path safety:** the path is validated before signing and again before serving; drivers' own checks (`LocalDriver` directory and symlink checks) still apply.
- **Bandwidth:** bytes pass through the app, unlike cloud presigned URLs. The docs point out the cost and suggest running the handler near the storage.

## Runtime notes

- The handler is web-standard (`Request` in, `Response` with a stream out) and runs anywhere the Framework does. `LocalDriver` links need Node.js or Bun; WebDAV links also run on the edge.
- Streams are passed through without buffering, with backpressure from the client connection.

## Alternatives considered

- **JWT links.** Rejected: larger URLs, an algorithm field to validate, and nothing gained over a fixed HMAC format.
- **Storing every link in a database** for revocation. Rejected as the default; it makes the Framework stateful. The `check` hook lets an app or Infrastructure add state where it is needed.
- **Proxying cloud storage through the app too.** Available with `mode: "always"`, but not the default, because native presigned URLs keep bytes off the app's bandwidth.

## Testing

- Signing and verifying: every signed field changes the signature; tampered path, `exp`, disposition and filename are refused; expired links; rotation (old secret still verifies, new one signs); secrets under 32 bytes rejected.
- Serving: headers, `HEAD`, `206` ranges on Local and WebDAV, full `200` for drivers without ranges, `signal` stops the driver read when the client disconnects, `check` refusal, events emitted.
- Security: inline refused for HTML and SVG, CSP and `nosniff` present, path traversal attempts refused before reaching the driver.
- Uploads: signed fields enforced, `Content-Length` over `maxSize` refused, false `Content-Length` caught while streaming, overwrite on reuse, CORS preflight.

## Open questions

1. Should `disposition: "inline"` be allowed for images, PDFs, audio and video by default, given previews need it and those types are safe with the sandbox CSP?
2. Is 5 GiB the right default `maxSize` for upload links, or should the app always set it?
3. Should `check` also receive the request's IP, for download limits per visitor, or is that Infrastructure's job?
