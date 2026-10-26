# Changelog

All notable changes to Fileway are documented here. Releases are cut from `main` via the [automated release workflow](.github/workflows/release.yml) with npm provenance (SLSA) attestation on every publish.

## Upcoming: v1.0.0

The first stable release. Target scope, tracked on the [roadmap](README.md#roadmap):

- **Stable public API**: ⏳ not yet. `UploadOptions`, `UploadResult<TMeta>`, `BaseDriver`, and `FilewayClient` lock in 1.0 semantics; after that, breaking changes become semver-major. The API is still changing (see the breaking changes in v0.3.0), so this is the main item left.
- **True streaming uploads**: ✅ landed for all drivers. Local pipes straight to disk with backpressure; S3 uses `aws-chunked` per-chunk SigV4 signing when `options.size` is known and bounded-memory multipart uploads otherwise; Cloudinary uses chunked uploads (`X-Unique-Upload-Id` + `Content-Range`) for files larger than `chunkSize`.
- **Upload cancellation**: ✅ landed for all drivers: `options.signal` rejects with `AbortError` and cleans up partial artifacts.
- **Middleware stream transformation**: ✅ landed: `beforeUpload` can return a replacement `stream` (and/or `options`), which is what the driver uploads. The known `size` is dropped when the stream is replaced unless the middleware returns the new length.
- **Operational hardening**: ✅ landed: progress events (`options.onProgress`), typed errors (`StorageError` codes), retries with backoff (`retry` config + `isRetryable`), and dependency-free `logger`/`onError` hooks.
- **Signed downloads**: ✅ landed for S3 (SigV4 presigned URLs) and Cloudinary (expiring private download URLs) via `getPresignedUrl`.

Expected: once the public API is frozen and has gone through real-world feedback via [GitHub Discussions](https://github.com/Goldenhub/fileway/discussions).

## v0.4.0 (2026-10-26)

**Features**
- **Lost-response recovery.** When an upload fails with a retryable error, `FilewayClient` now checks whether the provider stored the object anyway (the response was lost, not the upload). If it did, the upload succeeds with that object instead of re-sending it or failing. This works even without `streamFactory`.
- **Stable upload IDs.** Each `upload()` call gets one `id`, reused by every retry, so a retry can never store a second copy. Pass your own `UploadOptions.id` to make uploads idempotent across processes; reusing an ID overwrites that object.
- **`client.getUploadStatus(id, { filename, path })`** reports `complete` (with the stored object), `pending`, `missing` or `unsupported`, straight from the storage provider.
- **`retry.idleTimeoutMs`** (opt-in): cancels an attempt that makes no progress for that long and retries it as a `network` failure, so a hung connection no longer waits forever. For uploads it measures inactivity (it resets on every chunk read, then limits the wait for the reply), so slow but moving uploads are not cut off; other operations get a per-attempt time limit. The caller's own `signal` stays final.
- **Driver contract:** new optional `BaseDriver.pathFor`, `head` and `isPending`, implemented by all three drivers. Custom drivers that add `pathFor` and `head` get recovery and status checks automatically.

**Changes**
- Uploads stamp a per-call `uploadToken` on the object (S3 metadata `x-amz-meta-fileway-upload-token`, Cloudinary context `fileway_upload_token`) so recovery never mistakes an older upload with the same ID for this one. Drivers and middleware now see `id` and `uploadToken` in the upload options.
- **Cloudinary:** uploads send `public_id` (the upload ID) with `overwrite=true`, so new public IDs are UUIDs (or your `id`) instead of Cloudinary's short random IDs.
- **Local:** files are written to a temporary `*.partial` file and renamed into place when complete, so a failed retry never truncates or deletes a finished file.

## v0.3.0 (2026-10-26)

This release contains breaking changes (allowed before 1.0 as a minor bump). Read the breaking changes and migration notes before upgrading.

**Breaking changes**
- **`delete` throws on real failures.** All drivers return `false` only when the file does not exist; auth, network and provider failures now throw a `StorageError` (and are retried by the client when transient). S3 returns `true` whenever the object is gone, since S3 does not report whether it existed. Local `delete` with a path escaping the storage directory now throws a `ValidationError` instead of returning `false`.
- **`maxSizeBytes` violations use the `size-exceeded` code** (Local and Cloudinary) instead of `ValidationError`/`validation`.
- **Plain errors are no longer retried by default.** Among non-`StorageError` failures, only `TypeError` (what `fetch` throws on network failure) retries unless `retry.retryGenericErrors` is set. Set it to `true` for the old behavior.
- **Cloudinary `getUrl`/`get`/`delete`/`getPresignedUrl` throw when the Admin API lookup fails** (auth, rate limit, outage) instead of silently assuming an `image` asset.
- **A middleware that returns a new `stream` must return its `size` to keep one.** Length-preserving transforms (checksums, validation) should return `size: options.size`; otherwise the size is dropped (S3 then uses multipart, and progress has no total).
- **Cloudinary `getPresignedUrl` returns a different URL** (see Fixes); use `getSignedUrl` for the old format.

**Migration**
- Wrap `delete` calls in `try/catch` if you relied on `false` for failures; `false` now only means the file did not exist.
- Check `err.code === "size-exceeded"` (not `instanceof ValidationError`) for `maxSizeBytes` violations.
- Set `retry: { retryGenericErrors: true }` to keep retrying plain errors.
- In `beforeUpload` middleware that returns a same-length `stream`, also return `size: options.size`.
- Use `CloudinaryDriver.getSignedUrl()` where you need the old non-expiring signed delivery URL.

**Features**
- **S3: temporary credentials.** `credentials.sessionToken` is sent and signed as `x-amz-security-token` (and `X-Amz-Security-Token` in presigned URLs), enabling STS, Lambda/ECS roles and SSO.
- **Cloudinary: chunked uploads with bounded memory.** Files larger than `chunkSize` (default 20 MiB, minimum 5 MiB) upload in chunks via `X-Unique-Upload-Id` + `Content-Range` instead of being buffered whole, and `maxSizeBytes` is enforced while streaming.
- **Cloudinary: bounded lookup cache**: `cacheSize` (default 1000) caps the in-memory resource-type/version/format cache with least-recently-used eviction.
- **Cloudinary: delivery types.** Upload as `upload` (public), `authenticated` or `private` via the driver's `deliveryType` config or a per-upload `deliveryType` option. `getUrl`/`get` sign URLs for non-public assets, `delete` uses the asset's delivery type, and lookups can be filtered by type. `meta.deliveryType` reports it.
- **Driver-specific upload options through the client**: `FilewayClient.upload` now accepts the driver's own upload options (e.g. Cloudinary's `deliveryType`) on top of `UploadOptions`.
- **Cancellable retries**: `delete`, `get`, `getUrl` and `getPresignedUrl` on `FilewayClient` accept `{ signal }`; aborting stops further attempts and interrupts a pending retry delay.

**Fixes**
- **S3: long multipart uploads no longer fail partway through.** Each request (create, every part, complete, abort) is now signed with the time it is sent. Previously all were signed with the upload's start time, so uploads running longer than ~15 minutes were rejected with `RequestTimeTooSkewed`.
- **Retries no longer re-apply middleware.** Each `upload` retry now runs `beforeUpload` middleware on the caller's original options instead of the previous attempt's transformed ones (e.g. a path-prefixing middleware no longer prefixes twice).
- **Cloudinary: `getPresignedUrl` now actually expires.** Cloudinary ignores `expires_at` on `res.cloudinary.com` delivery URLs, so the previous links never expired. It now returns a signed private download URL (`api.cloudinary.com/v1_1/<cloud>/<type>/download`) that stops working at `expires_at`. The previous signed delivery URL is available as `CloudinaryDriver.getSignedUrl()` (non-expiring).
- **S3: a part with no `ETag` now fails clearly** (with a hint about browser CORS `ExposeHeaders`) instead of completing with an invalid substitute ETag.
- **S3: `forcePathStyle` is now honored**: `true` gives path-style AWS URLs; `false` with a custom `endpoint` gives virtual-hosted URLs. Defaults are unchanged.
- **Cloudinary search lookups quote and escape public IDs**, so IDs with spaces, quotes or colons resolve to the right asset.
- `version` exported from `@fileway/core` now reports the real package version.
- **Middleware that replaces the stream no longer leaves a stale `size`.** Previously a `beforeUpload` returning a stream of a different length (e.g. gzip) kept the caller's `options.size`, so S3 uploads failed with a size mismatch and progress totals were wrong. The size is now dropped unless the middleware returns it (`size` on the result, or a changed `options.size`).

**Docs site**
- Redesigned the landing page and docs in a light-first style with Fileway's amber accent, with a light/dark theme toggle.
- Docs pages gained "Copy Markdown" and "Open" actions (backed by per-page Markdown at `/md/<page>.md`), a section label above each title, and a "Was this page helpful?" row.
- The header logo is now a 4 KB image instead of a 571 KB one.

## v0.2.1 (2026-09-03)

- **Automatic retries with backoff**: `FilewayClient` retries transient failures at the client layer via a new `retry` config (`{ maxRetries, baseDelayMs, maxDelayMs, multiplier, jitter, retryHttpStatuses, retryGenericErrors }`). `delete`, `get`, `getUrl`, and `getPresignedUrl` retry automatically (idempotent); `upload` retries only when `UploadOptions.streamFactory` is provided to re-produce the stream per attempt (a `ReadableStream` is single-use). Uses exponential backoff with full jitter (interruptible by abort). Only `network`, `provider-error`, and HTTP 429/5xx statuses retry; `validation`/`config`/`auth-failed`/`not-found`/`bucket-not-found`/`size-exceeded`/`AbortError` never do. Exports `isRetryable(err, config)` for reuse, and `retry` as an `Operation`. Each retry logs a `warn`; `onError` fires only on the final failure.

## v0.2.0 (2026-09-03)

**BREAKING: Package rename**: `@fileway/driver-local`, `@fileway/driver-s3`, and `@fileway/driver-cloudinary` are now `@fileway/local`, `@fileway/s3`, and `@fileway/cloudinary`. The old package names are deprecated on npm; install the new names instead.

**Security: path-traversal fix in `@fileway/local`**: the storage directory containment check used a raw string prefix match (`fullPath.startsWith(root)`) which was vulnerable to sibling-directory escape (e.g., `path: "../storage2"` passing the guard when a sibling directory shares the name prefix). Replaced with a `relative()`-based check that correctly rejects all escapes. Added symlink following defense: any symlink component inside the storage directory is now rejected before any I/O, preventing read/write/delete of files outside the root via planted symlinks. 7 new regression tests.

**Migration:**
```bash
npm uninstall @fileway/driver-local @fileway/driver-s3 @fileway/driver-cloudinary
npm install @fileway/local @fileway/s3 @fileway/cloudinary
```

## v0.1.0 (2026-07-31)

- **Optional `logger` + `onError` callbacks**: `FilewayClient` config now accepts a dependency-free `logger` (`{ debug?, info?, warn?, error? }`) and an `onError(error, context)` hook, so you can plug in your own tooling (Pino, Sentry, Datadog) with a few lines and no adapter package. The logger receives `"<operation> started/succeeded"` `info` events (structured meta: `operation`, `path`, `filename`, `size`, `id`, `url`, `durationMs`) and `error` on failures; it is silent when omitted, and a throwing logger never breaks the operation it reports on. `onError` is awaited with the raw error plus `{ operation, durationMs, path, ... }` context before the error is rethrown; it is **skipped for aborts** (`AbortError` is cancellation, not failure) but fires for `ValidationError`/`config` errors, and a throwing `onError` never masks the original error. New exports: `Logger`, `LogLevel`, `Operation`, `ErrorContext` in `@fileway/core`.
- **Typed error taxonomy**: `@fileway/core` now exports a single `StorageError` (with the `StorageErrorCode` union: `validation`, `config`, `not-found`, `bucket-not-found`, `auth-failed`, `size-exceeded`, `network`, `provider-error`) carrying optional `statusCode`, `provider`, and `cause`, plus `isAbortError()`. `ValidationError` is now a `StorageError` subclass (`code === "validation"`, `instanceof` behavior unchanged), and abort signals still surface as standard `DOMException`/`AbortError`. All drivers throw typed errors instead of generic `Error`s: S3 classifies AWS/MinIO XML `<Code>` responses (`NoSuchBucket`, `NoSuchKey`/`NoSuchUpload`, `AccessDenied`/`InvalidAccessKeyId`/`SignatureDoesNotMatch`/`ExpiredToken`/`InvalidToken`, `EntityTooLarge`) with an HTTP-status fallback, wraps non-abort `fetch` failures as `network` (preserving the cause), and throws `config` when credentials are missing; Cloudinary maps status (401/403 → `auth-failed`, upload 404 → `bucket-not-found`, get 404 → `not-found`, 413 → `size-exceeded`, else `provider-error`); Local classifies missing files as `not-found`; `FilewayClient.getPresignedUrl` throws `config` for drivers without presigned-URL support. Message strings are unchanged, so existing callers keep working. This is the foundation for retries (retry `network`/`provider-error` only).
- **`@fileway/s3`: presigned URLs**: `getPresignedUrl(path, { expiresIn })` (with a `FilewayClient.getPresignedUrl` passthrough) returns a time-limited, SigV4-signed GET URL so a file in a private bucket can be downloaded by anyone holding the link, with no credentials and no network call to sign it. Auth travels in the query string (`X-Amz-Algorithm`, `X-Amz-Credential`, `X-Amz-Date`, `X-Amz-Expires`, `X-Amz-SignedHeaders=host`, `X-Amz-Signature`) and only `host` is signed with an `UNSIGNED-PAYLOAD` hash. `expiresIn` defaults to `3600` seconds and must be an integer in `1..604800` (AWS's 7-day cap) or a `ValidationError` is thrown. Works with `endpoint`/`forcePathStyle` (MinIO, R2) and reuses the existing Web Crypto SigV4 primitives. Verified against AWS's documented presigned-URL example and a live MinIO round-trip.
- **`@fileway/cloudinary`: presigned URLs**: `getPresignedUrl(publicId, { expiresIn, deliveryType })` returns a Cloudinary signed delivery URL (the `/s--SIG--/` path component plus `?expires_at=`) using the same `{ resourceType, version }` hint / upload-cache / Admin API resolution chain as `getUrl`. The signature is the first 8 characters of a URL-safe base64 `SHA-1` digest of the resource path concatenated with the API secret, computed purely with Web Crypto. `expiresIn` defaults to `3600` and must be a positive integer. The signature restricts access only for assets with `authenticated`/`private` delivery (pass `deliveryType`); `upload`-type assets created by `CloudinaryDriver.upload` are already public, so their signed URLs resolve but do not gate access. Signature format verified against Cloudinary's documented delivery-signature example.
- **New optional `BaseDriver.getPresignedUrl?`**: S3 and Cloudinary implement it; Local omits it and `FilewayClient.getPresignedUrl` throws a clear error for drivers without support.
- **Upload progress (`onProgress`)**: pass `options.onProgress` to `client.upload()` on any driver to receive `{ bytes, total?, progress? }` as chunks flow through the stream (new exported `UploadProgress` type in `@fileway/core`). `total`/`progress` are reported only when `options.size` is known. Cadence is adaptive: chunks ≥ 256 KiB (or ≥ 5% of a known total) report immediately, smaller chunks coalesce to ~1 event per 100 ms, and an exact final event always fires (`progress` reaches exactly `1`). No event fires on abort. Progress is counted at the client layer, so every driver gets it with zero driver changes; Cloudinary reports during its pre-signature `Blob` buffering (its `fetch` upload exposes no progress).
- **`@fileway/cloudinary`: resource type resolution for `getUrl`/`delete`/`get`**: `getUrl(publicId, options?)` and `delete(publicId, options?)` now resolve an asset's `resource_type`/`version` via an explicit hint (`{ resourceType, version }`), the in-memory upload cache, then a one-time Cloudinary Admin API `resources/search` lookup (Basic auth) before defaulting to `image`. Assets uploaded by another process or before a restart no longer produce broken `/image/` URLs or failed deletes for video/raw files. `delete` now uses the Admin API `DELETE /resources/{type}/upload` endpoint with the resolved type and returns `false` for unknown assets without issuing a destroy call.
- **Upload cancellation (`AbortSignal`)**: pass `options.signal` to `client.upload()` on any driver to cancel an in-flight upload. Drivers reject with a `DOMException` named `AbortError` (exported helper `abortError()` in `@fileway/core`). Local destroys both streams and unlinks the partial file; S3 aborts the request and, for multipart uploads, sends `AbortMultipartUpload` so no orphaned parts remain; Cloudinary aborts the upload request.
- **Streaming downloads (`get(path)`)**: new `BaseDriver.get(path): Promise<ReadableStream<Uint8Array>>` method on every driver, with a `FilewayClient.get(path)` passthrough. Files stream back pull-based with backpressure instead of being buffered whole. Local streams from disk (`createReadStream` → `Readable.toWeb`), S3 uses an authenticated SigV4 `GET`, and Cloudinary fetches the public CDN URL. Missing paths throw.
- **`@fileway/s3`: bounded-memory streaming uploads**: pass `options.size` (≤ 5 GiB) and the payload is uploaded as a SigV4 `aws-chunked` body (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD`); chunks are signed lazily as the stream is read, so memory stays constant regardless of file size.
- **`@fileway/s3`: multipart uploads**: unknown sizes and objects > 5 GiB now stream through a multipart upload (`CreateMultipartUpload` → `UploadPart` → `CompleteMultipartUpload`) into part-sized buffers (default `8 MiB`, minimum `5 MiB`), so peak memory stays bounded even without a declared size. Configurable via `partSize` and `forceMultipart`.
- **`@fileway/s3`: size-mismatch safety**: streams that end before/after the declared `size` abort the upload and throw a validation error instead of storing a corrupted object.
- Launch docs: rewritten `README.md`, new `CHANGELOG.md`, and npm `keywords` on all four packages.

## v0.0.5 (2026-07-31)

- **CI stability**: build now runs before typecheck (drivers resolve `@fileway/core` types from build output); CI and release builds target only publishable packages (no docs build).
- Cross-package version alignment at `0.0.5`.

## v0.0.4 (2026-07-31)

- **npm provenance** via Trusted Publishers (OIDC): no stored `NPM_TOKEN`; every publish ships SLSA attestation signed by GitHub Actions.
- MIT licensing added to all packages.
- Package READMEs with npm version and bundle-size badges.

## v0.0.3 (2026-07-31)

First public release of all four packages.

- **`@fileway/core`**: zero-dependency client engine, types, middleware pipeline.
- **`@fileway/s3`**: rewritten to **zero runtime dependencies**: hand-rolled SigV4 signing over pure `fetch` + Web Crypto, streaming `ReadableStream<Uint8Array>` bodies. Removed `@aws-sdk/lib-storage` and all `node:*` imports.
- **`@fileway/cloudinary`**: rewritten to **zero runtime dependencies**: `fetch` + `FormData` + Web Crypto (`crypto.subtle` SHA-1 signatures). Removed the `cloudinary` SDK.
- **`@fileway/local`**: native `node:fs` streams with path-traversal guards and size limits.
- Cross-runtime support verified: Node.js, Bun, Cloudflare Workers (edge-runtime tests), and Deno.
- Conditional exports (`worker`, `deno`, `bun`, `import`, `require`) on every package.
