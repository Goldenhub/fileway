# RFC 0003: `@fileway/webdav` driver

- **Status:** Draft
- **Target:** `@fileway/webdav` 0.1
- **Depends on:** [RFC 0001](./0001-list-copy-move.md) (list, stat, copy, move). Sharing from the dashboard also needs app-signed links ([RFC 0004](./0004-app-signed-links.md)), shared with `LocalDriver`.

## Summary

A universal driver for WebDAV servers: Nextcloud, ownCloud, Synology and QNAP NAS boxes, Apache `mod_dav`, rclone and hosted WebDAV services. WebDAV is plain HTTP, so the driver uses only `fetch`, `TextEncoder` and Web Crypto, with no dependencies and no `node:*` imports. It runs on Node.js, Bun, Deno and edge runtimes.

```ts
import { WebDAVDriver } from "@fileway/webdav";

const driver = new WebDAVDriver({
  url: "https://cloud.example.com/remote.php/dav/files/alice",
  auth: { username: "alice", password: process.env.NEXTCLOUD_APP_PASSWORD },
});
```

## Motivation

Network disks (office NAS, self-hosted file servers) are the main storage Fileway cannot reach today without mounting a share on the server. Of the network-disk protocols, only WebDAV fits the Framework's rules: SMB and NFS have no usable JavaScript clients, and SFTP needs raw TCP and an SSH library. Most NAS brands and every Nextcloud or ownCloud install speak WebDAV, so one driver covers a large share of real setups, including ones a cloud-hosted app can reach over HTTPS.

## The protocol, in short

WebDAV ([RFC 4918](https://www.rfc-editor.org/rfc/rfc4918)) adds methods to HTTP:

| Method | Used for |
|---|---|
| `GET`, `PUT`, `DELETE` | Read, write, delete a file |
| `MKCOL` | Create a folder |
| `PROPFIND` | Read properties of a file or folder; with `Depth: 1`, list a folder |
| `PROPPATCH` | Set custom ("dead") properties on a file |
| `COPY`, `MOVE` | Copy or rename, with `Destination` and `Overwrite` headers |

Responses to `PROPFIND` and `PROPPATCH` are XML (`207 Multi-Status`).

## Configuration

```ts
export interface WebDAVDriverConfig {
  /** Base URL of the WebDAV root to store under (all paths are relative to it). */
  url: string;
  auth?:
    | { username: string; password: string }   // Basic auth; use app passwords
    | { token: string }                        // Bearer token
    | { headers: Record<string, string> };     // anything else (e.g. a proxy's header)
  /** Public base URL for getUrl (e.g. a share or CDN). Default: `url`. */
  baseUrl?: string;
  /** Reject uploads larger than this many bytes with size-exceeded. */
  maxSizeBytes?: number;
  /**
   * How to send uploads.
   * "stream" (default): one PUT with a streaming body.
   * "buffer-small": buffer files up to `bufferLimit` (default 8 MiB) so the
   *   PUT carries a Content-Length, for servers that reject chunked bodies;
   *   larger files still stream.
   * "nextcloud": Nextcloud chunked upload v2 for large files (resumable parts).
   */
  uploadMode?: "stream" | "buffer-small" | "nextcloud";
  /** Allow http:// URLs. Default false: credentials would travel in clear text. */
  allowInsecure?: boolean;
}
```

## Operations

### `upload`

1. **Create missing folders.** `PUT` fails with `409 Conflict` when the parent folder is missing. The driver sends `MKCOL` for each missing segment, then retries the `PUT` once. Known folders are cached per driver instance; `405 Method Not Allowed` on `MKCOL` means the folder already exists and is treated as success.
2. **Write to a temporary name, then move.** The body goes to `<name>.<uuid>.partial` with `PUT`, then `MOVE` to the final name with `Overwrite: T`. Readers never see a half-written file, and a failed retry never damages a finished one. This matches `LocalDriver`.
3. **Store the upload token** with `PROPPATCH`, as a dead property `fw:upload-token` in the namespace `https://usefileway.dev/ns/webdav`. User `metadata` is stored the same way, one property per key. If the server rejects dead properties (some minimal servers do), the driver remembers that and skips them. Lost-response recovery then falls back to the size check, as on `LocalDriver`.
4. **Streaming body.** The `PUT` body is the stream itself, with `duplex: "half"`. Bytes are counted on the way through to enforce `maxSizeBytes` and to check a declared `size`; on a mismatch the request is aborted and the `.partial` file deleted.
5. **Cancellation.** `signal` aborts the `PUT` and the driver deletes the `.partial` file (best effort).

`pathFor`, `head` and `isPending` follow `LocalDriver`: `<path>/<id>.<ext>`, a `PROPFIND Depth: 0` for `head`, and a `.partial` sibling for `isPending`.

### `get`, `delete`, `getUrl`

- `get`: `GET`, returning the response body as a stream. `signal` cancels it.
- `delete`: `DELETE`. `404` is success (missing objects are not errors).
- `getUrl`: `baseUrl` plus the encoded path. Most WebDAV servers need credentials for that URL, which the docs state plainly.

### `list` (RFC 0001)

`PROPFIND` with `Depth: 1` and a body asking only for `resourcetype`, `getcontentlength`, `getlastmodified`, `getetag` and `getcontenttype`. Entries with `<collection/>` become `folders`; the rest become `objects`. `.partial` files are skipped.

- **Recursive:** many servers disable `Depth: infinity`, so `recursive: true` walks folders with `Depth: 1`, breadth first.
- **Paging:** WebDAV has no paging. The driver lists the whole folder, sorts it by name and returns pages from it; the cursor encodes the folder, the walk position and the last name returned. Very large folders (tens of thousands of files) are slow on the server side, which the docs note.

### `copy`, `move` (RFC 0001)

`COPY` and `MOVE` with `Destination` (absolute URL) and `Overwrite: F` when `overwrite` is false. `412 Precondition Failed` maps to `conflict`. Missing destination folders are created first, as for uploads.

### `getPresignedUrl`

WebDAV has no signed URLs. The driver does not implement `getPresignedUrl`. Sharing and previews in Fileway Infrastructure use **app-signed links**: the client's handler (RFC 0002) issues a URL to the app itself with an HMAC signature and an expiry, and streams the file from the driver when it is opened. That mechanism is shared with `LocalDriver` and specified in [RFC 0004](./0004-app-signed-links.md), which also adds the `range` option WebDAV uses for video seeking. Nextcloud's own share API is out of scope.

## XML parsing

There is no `DOMParser` in Node.js or Workers, and the Framework takes no dependencies. The driver ships a small, purpose-built `207 Multi-Status` reader:

- A tokenizer for elements, text and CDATA, enough for well-formed `multistatus` documents. No DTDs or entities beyond the five predefined ones and numeric references.
- Namespace-aware by URI, not by prefix: servers use `d:`, `D:`, `lp1:` and no prefix for the same `DAV:` namespace.
- Each `<response>` yields `href` (percent-decoded and made relative to `url`), its `propstat` groups with status, and the properties the driver asked for.
- Tested against recorded responses from Nextcloud, Apache `mod_dav`, Synology, rclone and SabreDAV.

## Errors

| Response | Code |
|---|---|
| `401`, `403` | `auth-failed` |
| `404` on read | `not-found` (on `delete`: success) |
| `409` on write | missing parent; handled internally, otherwise `provider-error` |
| `412` on `COPY`/`MOVE` with `Overwrite: F` | `conflict` |
| `413`, `507 Insufficient Storage` | `size-exceeded` |
| `423 Locked` | `provider-error` with `statusCode: 423` (retryable) |
| `429` | `rate-limited` |
| `5xx` | `provider-error` |
| `fetch` failed | `network` |
| `http://` without `allowInsecure` | `config`, at construction |

## Server compatibility

| Server | URL pattern | Notes |
|---|---|---|
| Nextcloud, ownCloud | `https://host/remote.php/dav/files/<user>` | Dead properties supported. Use an app password. `uploadMode: "nextcloud"` for large files. |
| Synology DSM | `https://host:5006/<shared folder>` | Enable the WebDAV Server package; HTTPS on port 5006. |
| QNAP QTS | `https://host/<shared folder>` | Enable WebDAV per shared folder. |
| Apache `mod_dav` | any | Reference implementation; used in CI. |
| rclone `serve webdav` | any | Lets any rclone remote (SFTP, SMB, Google Drive) be reached through this driver. |
| nginx | any | The built-in `dav` module lacks `PROPFIND`; needs `nginx-dav-ext-module`. Listing will not work without it. |

The rclone row matters: `rclone serve webdav` turns SFTP and SMB shares into WebDAV, which covers those protocols for teams that need them before any native driver exists.

## Security

- `https://` only unless `allowInsecure` is set, since Basic auth sends the password with every request.
- Credentials live in the app's config, never in events (RFC 0002) or error messages.
- Paths are validated with the core rules and encoded per segment; `..` segments are rejected, so a path cannot escape `url`.
- Redirects: `fetch` follows them by default and would resend `Authorization` to the same origin only; cross-origin redirects drop credentials and fail with `auth-failed`, which is documented.

## Testing

- Unit tests with mocked `fetch`: folder creation on `409`, `.partial` plus `MOVE`, dead-property fallback, size mismatch and abort cleanup, `PROPFIND` parsing with different namespace prefixes, paging over a sorted listing, recursive walk, every row of the error table.
- Integration in CI against Apache `mod_dav` in Docker (a small image with `mod_dav` and `mod_dav_fs`), gated like the MinIO and Azurite suites. An opt-in live test for Nextcloud with `NEXTCLOUD_URL`, `NEXTCLOUD_USER` and `NEXTCLOUD_APP_PASSWORD`.
- Edge runtime: unit tests run under `edge-runtime`, like the other universal drivers.

## Alternatives considered

- **Use the `webdav` npm package.** Rejected: it brings dependencies and Node-specific code paths, which universal drivers do not allow.
- **Skip the `.partial` write and `PUT` straight to the final name.** Simpler, one request fewer, but a failed upload leaves a truncated file in place of a good one. Kept as a possible `atomic: false` option if the extra `MOVE` proves costly.
- **Native SMB or NFS drivers.** Rejected for now; see Motivation. Mounting the share and using `LocalDriver`, or putting `rclone serve webdav` in front, covers them.

## Open questions

1. Should `uploadMode` default to `"buffer-small"` for safety, since some servers reject chunked request bodies, at the cost of buffering files up to 8 MiB?
2. Use `LOCK`/`UNLOCK` around writes on servers that support it, to stop two uploads to the same id from racing? The `.partial` plus `MOVE` approach already gives last-writer-wins.
3. Should Nextcloud get its own preset (`nextcloud({ host, user, appPassword })`) that fills in the URL pattern and upload mode?
