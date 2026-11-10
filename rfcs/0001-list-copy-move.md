# RFC 0001: Listing, copying, moving and stat

- **Status:** Implemented (unreleased, planned for 0.6.0)
- **Target:** 0.6.0 (additive apart from the new `conflict` error code)
- **Drivers:** Local, S3, GCS, Azure, Supabase, Cloudinary

## Summary

Add four operations to Fileway: list the objects under a prefix, read one object's metadata, copy an object, and move (rename) an object. All four are optional `BaseDriver` methods, so existing and third-party drivers keep working, and `FilewayClient` gains matching methods with the usual retries, logging, `onError` and `signal` support.

## Motivation

Today Fileway can store, read, delete and link to a file whose path you already know. It cannot answer "what is in this folder?" or "rename this file", which every file browser, admin tool, cleanup job and migration script needs. Developers currently drop down to each provider's SDK for these, which defeats the point of one API.

## Design

### Types (`packages/core/src/types.ts`)

```ts
export interface ListOptions extends OperationOptions {
  /** Only return objects whose path starts with this. "" or omitted lists the root. */
  prefix?: string;
  /**
   * `false` (default): one folder level. Objects directly under `prefix` go in
   * `objects`; deeper paths are rolled up into `folders`.
   * `true`: every object under `prefix`, at any depth; `folders` is empty.
   */
  recursive?: boolean;
  /** Page size hint, 1 to 1000. Default 100. Drivers may return fewer. */
  limit?: number;
  /** The `cursor` from the previous page. */
  cursor?: string;
}

export interface ListedObject {
  path: string;
  size: number;
  lastModified?: Date;
  etag?: string;
  contentType?: string;
}

export interface ListPage {
  objects: ListedObject[];
  /** Folder prefixes one level below `prefix`, each ending in "/". */
  folders: string[];
  /** Present when there are more results. Opaque; pass it back unchanged. */
  cursor?: string;
}

export interface CopyOptions extends OperationOptions {
  /** Fail with `conflict` instead of replacing an existing destination. Default false. */
  overwrite?: boolean;
}

export interface BaseDriver<TMeta> {
  // ...existing methods...
  list?(options?: ListOptions): Promise<ListPage>;
  copy?(from: string, to: string, options?: CopyOptions): Promise<void>;
  move?(from: string, to: string, options?: CopyOptions): Promise<void>;
}
```

`head` already exists and stays the driver primitive for stat. `list` returns `ListedObject`, not `StoredObject`: listing APIs return less than a full metadata read (no custom metadata, often no content type), and promising more would force one extra request per object.

### Client (`packages/core/src/index.ts`)

```ts
client.list(options?): Promise<ListPage>
client.listAll(options?): AsyncIterable<ListedObject>   // follows cursors
client.stat(path, options?): Promise<StoredObject<TMeta> | null>   // wraps head
client.copy(from, to, options?): Promise<void>
client.move(from, to, options?): Promise<void>
```

- All of them go through `runWithRetry`, so they get retries, the idle time limit, logging and `onError`. `Operation` gains `"list" | "stat" | "copy" | "move"`.
- A driver without the method throws `StorageError("config", "driver <name> does not support <op>")`, the same pattern as `getPresignedUrl`.
- `move` falls back to `copy` then `delete` when the driver has `copy` but no native `move`. The fallback is not atomic: if the delete fails, both copies exist and the error is thrown. This is documented.
- `listAll` stops when the caller's `signal` aborts or the loop breaks early.
- `copy` and `move` validate both paths with the existing path rules. Copying a path onto itself throws `validation`.

### New error code

`conflict`: the destination exists and `overwrite` is false. Added to `StorageErrorCode`; not retryable. Adding a code is a minor change for exhaustive `switch` statements, so it should ship in 1.0 rather than 1.1 if this RFC is accepted before the freeze.

## Per-driver implementation

| Driver | `list` | `copy` | `move` | Notes |
|---|---|---|---|---|
| Local | `readdir` (recursive walk when `recursive`) + `stat` | `fs.copyFile` (`COPYFILE_EXCL` when not overwriting) | `fs.rename`; on `EXDEV` (another disk) copy then unlink | Cursor is an encoded offset into a sorted listing. Skips `.partial` files. |
| S3 | `ListObjectsV2` with `prefix`, `delimiter=/` (one level), `max-keys`, `continuation-token` | `CopyObject` (`x-amz-copy-source`) up to 5 GiB; above that, multipart `UploadPartCopy` | copy then delete (S3 has no rename) | `overwrite: false` uses `If-None-Match: *` where supported (AWS, R2); otherwise a `head` check, documented as not race-free. |
| GCS | `objects.list` with `prefix`, `delimiter`, `maxResults`, `pageToken` | `objects.rewrite`, looping on `rewriteToken` until `done` | copy then delete | `overwrite: false` uses `ifGenerationMatch=0`, which is atomic. |
| Azure | List Blobs (`restype=container&comp=list`) with `prefix`, `delimiter`, `maxresults`, `marker` | Copy Blob (`x-ms-copy-source`); poll `x-ms-copy-status` until `success` when it returns `pending` | copy then delete | `overwrite: false` uses `If-None-Match: *` (atomic). Copy source must be readable: same account, or a SAS URL. |
| Supabase | `POST /object/list/{bucket}` (`prefix`, `limit`, `offset`) | `POST /object/copy` | `POST /object/move` (native) | Supabase lists one level only. `recursive: true` walks folders client-side, depth first; cursor encodes the walk position. Folder entries come back with `id: null`. |
| Cloudinary | Admin API `GET /resources/{type}/{delivery}?prefix=&max_results=&next_cursor=` per resource type | Not supported natively; omit `copy` | `POST /{resource_type}/rename` (native) | Admin API calls are rate limited per hour (map 420/429 to `rate-limited`). Listing merges image, video and raw, which needs three cursors encoded into one. |

### Cursors

Each driver encodes its own position (S3 continuation token, Azure marker, Supabase offset, Cloudinary's three cursors) as base64url JSON. Callers treat it as opaque. A cursor is only valid for the same driver config and the same `prefix`/`recursive`; reusing it elsewhere throws `validation`.

### Folders

Object stores have no real folders; "folders" are shared prefixes. Fileway does not create or delete folders. An "empty folder" exists only where the provider stores one (Local directories, Supabase placeholder objects). This is called out in the docs so a file browser does not promise folder operations the storage cannot keep.

## Alternatives considered

- **Required methods instead of optional.** Rejected: it would break every custom driver and force Cloudinary to fake `copy`.
- **Recursive by default.** Rejected: on a large bucket a recursive list is slow and costly; one level matches what a file browser needs and what most APIs do cheaply.
- **Returning `StoredObject` from `list`.** Rejected (see above).
- **Cross-driver copy (S3 to GCS).** Out of scope. It is `get` from one client and `upload` to another, which callers can already do with streaming. A `transfer` helper can come later.

## Testing

- Unit tests per driver with mocked `fetch` (or a temp directory for Local): pagination across at least two pages, one-level vs recursive, folder rollup, `overwrite: false` conflicts, copy above the single-request limit (S3 multipart copy, GCS rewrite loop, Azure pending copy), `EXDEV` fallback, abort mid-listing.
- Integration: MinIO for S3 and Azurite for Azure in CI; GCS and Supabase opt-in live tests.
- Client: `listAll` across pages and early `break`, `move` fallback when the driver lacks `move`, unsupported-method errors.

## Decisions

1. No `filter` option on `list`: providers cannot filter server-side, so it would cost the same as filtering `listAll()` results in the caller, with uneven page sizes. It can be added later without breaking anything.
2. `copy` and `move` return `void`: returning the new object would cost an extra `head` on most providers. Callers use `stat` when they need it.
3. `conflict` ships with `copy` and `move` in 0.6.0, so the error-code list is final before 1.0.
