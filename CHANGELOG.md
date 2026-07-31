# Changelog

All notable changes to Fileway are documented here. Releases are cut from `main` via the [automated release workflow](.github/workflows/release.yml) with npm provenance (SLSA) attestation on every publish.

## Upcoming — v1.0.0

The first stable release. Target scope, tracked on the [roadmap](README.md#roadmap):

- **Stable public API** — `UploadOptions`, `UploadResult<TMeta>`, `BaseDriver`, and `FilewayClient` lock in 1.0 semantics. Breaking changes become semver-major.
- **True streaming uploads** — S3 multipart with per-chunk SigV4 signing (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD`), so large files stream without buffering.
- **Middleware stream transformation** — `beforeUpload` will be able to transform the stream itself, not just options.
- **Operational hardening** — progress events, retries with backoff, and classified error types across all drivers.
- **Signed downloads** — presigned URLs for S3 and Cloudinary assets.

Expected: once the roadmap items above land and the API has gone through real-world feedback via [GitHub Discussions](https://github.com/Goldenhub/fileway/discussions).

## v0.0.5 — 2026-07-31

- **CI stability**: build now runs before typecheck (drivers resolve `@fileway/core` types from build output); CI and release builds target only publishable packages (no docs build).
- Cross-package version alignment at `0.0.5`.

## v0.0.4 — 2026-07-31

- **npm provenance** via Trusted Publishers (OIDC) — no stored `NPM_TOKEN`; every publish ships SLSA attestation signed by GitHub Actions.
- MIT licensing added to all packages.
- Package READMEs with npm version and bundle-size badges.

## v0.0.3 — 2026-07-31

First public release of all four packages.

- **`@fileway/core`** — zero-dependency client engine, types, middleware pipeline.
- **`@fileway/driver-s3`** — rewritten to **zero runtime dependencies**: hand-rolled SigV4 signing over pure `fetch` + Web Crypto, streaming `ReadableStream<Uint8Array>` bodies. Removed `@aws-sdk/lib-storage` and all `node:*` imports.
- **`@fileway/driver-cloudinary`** — rewritten to **zero runtime dependencies**: `fetch` + `FormData` + Web Crypto (`crypto.subtle` SHA-1 signatures). Removed the `cloudinary` SDK.
- **`@fileway/driver-local`** — native `node:fs` streams with path-traversal guards and size limits.
- Cross-runtime support verified: Node.js, Bun, Cloudflare Workers (edge-runtime tests), and Deno.
- Conditional exports (`worker`, `deno`, `bun`, `import`, `require`) on every package.
