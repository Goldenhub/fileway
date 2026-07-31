# Fileway

[![CI](https://img.shields.io/github/actions/workflow/status/Goldenhub/fileway/ci.yml?branch=main&style=flat-square)](https://github.com/Goldenhub/fileway/actions)
[![npm version](https://img.shields.io/npm/v/@fileway/core?style=flat-square)](https://www.npmjs.com/package/@fileway/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@fileway/core?style=flat-square)](https://bundlephobia.com/package/@fileway/core)
[![license](https://img.shields.io/npm/l/@fileway/core?style=flat-square)](https://github.com/Goldenhub/fileway/blob/main/LICENSE)

**Fileway is a runtime-agnostic file storage engine for JavaScript/TypeScript.** One standard API for every storage provider and every runtime — with zero core dependencies.

Instead of learning a different SDK for S3, Cloudinary, and local disk — and fighting Node-specific shims on every edge runtime — Fileway gives you one typed API. Upload a WHATWG `ReadableStream<Uint8Array>`, get back a typed result. Swap drivers by changing **one line of code**. No rewrites. No provider lock-in.

- **Node.js 20+**, **Cloudflare Workers**, **Bun**, and **Deno 2** — the same code, everywhere.
- **Zero core dependencies.** `@fileway/core` ships with no runtime deps. The S3 driver is pure `fetch` + Web Crypto — no AWS SDK, no shims.
- **Real streaming** via `ReadableStream<Uint8Array>` — no whole-file buffering. Local disk streams to disk with backpressure; S3 streams with per-chunk SigV4 signing when the size is known and bounded-memory multipart uploads when it is not.
- **Type inference** — every driver returns its own metadata shape automatically.

---

## Runtime & driver support

| Package | Description | Runtime deps | Node | Workers | Bun | Deno |
| --- | --- | --- | :-: | :-: | :-: | :-: |
| `@fileway/core` | Client engine, types, middleware | **Zero** | ✅ | ✅ | ✅ | ✅ |
| `@fileway/driver-local` | Local filesystem | `node:fs` | ✅ | — | ✅ | ✅ |
| `@fileway/driver-s3` | AWS S3, MinIO, Cloudflare R2 | **Zero** *(pure `fetch` + Web Crypto)* | ✅ | ✅ | ✅ | ✅ |
| `@fileway/driver-cloudinary` | Cloudinary | **Zero** *(pure `fetch` + Web Crypto)* | ✅ | ✅ | ✅ | ✅ |

## 30-second quickstart

```bash
npm install @fileway/core @fileway/driver-local @fileway/driver-s3
```

```ts
import { FilewayClient } from "@fileway/core";
import { LocalDriver } from "@fileway/driver-local";

const client = new FilewayClient({
  driver: new LocalDriver({ directory: "./storage" }),
});

const result = await client.upload(
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("Hello, Fileway!"));
      controller.close();
    },
  }),
  { filename: "hello.txt", mimeType: "text/plain" },
);

console.log(result.path); // <uuid>.txt
console.log(result.size); // 15
```

**Move to S3 with one line.** Same client, same call — only the driver changes:

```ts
import { S3Driver } from "@fileway/driver-s3";

const client = new FilewayClient({
  driver: new S3Driver({
    bucket: "my-bucket",
    region: "us-east-1",
    credentials: { accessKeyId: "...", secretAccessKey: "..." },
  }),
});
```

To Cloudinary? Swap in `CloudinaryDriver`. Your application code never changes.

---

## Examples by runtime

### Node.js

```ts
import { FilewayClient } from "@fileway/core";
import { LocalDriver } from "@fileway/driver-local";
import { S3Driver } from "@fileway/driver-s3";

const driver =
  process.env.S3_DRIVER === "1"
    ? new S3Driver({
        bucket: process.env.S3_BUCKET ?? "fileway-demo",
        region: process.env.AWS_REGION ?? "us-east-1",
        endpoint: process.env.S3_ENDPOINT, // e.g. http://localhost:9000 (MinIO)
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "minioadmin",
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "minioadmin",
        },
      })
    : new LocalDriver({ directory: "./storage" });

const client = new FilewayClient({ driver });

const result = await client.upload(
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("Hello, Fileway!"));
      controller.close();
    },
  }),
  { filename: "hello.txt", path: "quickstart", mimeType: "text/plain" },
);

console.log(`Uploaded with "${driver.name}" driver:`, result.url);
```

```bash
node quickstart.mjs                       # local disk
S3_DRIVER=1 S3_ENDPOINT=http://localhost:9000 node quickstart.mjs   # S3/MinIO
```

### Cloudflare Workers

No Node.js, no shims, no AWS SDK. In a Worker, `request.body` *is* the `ReadableStream<Uint8Array>` Fileway streams to S3:

```ts
import { FilewayClient } from "@fileway/core";
import { S3Driver } from "@fileway/driver-s3";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") return new Response("POST a file", { status: 405 });

    const client = new FilewayClient({
      driver: new S3Driver({
        bucket: env.BUCKET,
        region: env.AWS_REGION,
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        },
      }),
    });

    const result = await client.upload(request.body!, {
      filename: new URL(request.url).searchParams.get("filename") ?? "upload.bin",
      path: "uploads",
    });

    return Response.json({ ok: true, ...result });
  },
};
```

```bash
npm install
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
npx wrangler dev
```

Cloudflare **R2** is S3-compatible — keep this exact code, just point `S3Driver` at your R2 endpoint (`region: "auto"`, `endpoint: "https://<ACCOUNT_ID>.r2.cloudflarestorage.com"`).

### Bun

Identical to Node.js — Fileway runs on Bun's built-in `node:fs` and WHATWG streams:

```ts
import { FilewayClient } from "@fileway/core";
import { LocalDriver } from "@fileway/driver-local";

const client = new FilewayClient({
  driver: new LocalDriver({ directory: "./storage" }),
});

const result = await client.upload(
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("Hello, Fileway!"));
      controller.close();
    },
  }),
  { filename: "hello.txt", mimeType: "text/plain" },
);

console.log(result);
```

```bash
bun run quickstart.ts
```

### Deno

Deno resolves the same packages straight from npm:

```ts
import { FilewayClient } from "npm:@fileway/core@0.0.5";
import { LocalDriver } from "npm:@fileway/driver-local@0.0.5";

const client = new FilewayClient({
  driver: new LocalDriver({ directory: "./storage" }),
});

const result = await client.upload(
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("Hello, Fileway!"));
      controller.close();
    },
  }),
  { filename: "hello.txt", mimeType: "text/plain" },
);

console.log(result);
```

```bash
deno run --allow-read --allow-write quickstart.ts
```

---

## How it works

Files flow as WHATWG `ReadableStream<Uint8Array>` through the `FilewayClient`:

```
stream ──▶ middleware.beforeUpload ──▶ driver.upload ──▶ middleware.afterUpload ──▶ UploadResult
```

- **Core is dependency-free** — `@fileway/core` has no runtime dependencies at all.
- **Universal drivers** — `driver-s3` and `driver-cloudinary` contain zero `node:*` imports. SigV4 signing uses Web Crypto (`crypto.subtle`); uploads use platform `fetch`. That's why they run on Workers, Bun, Deno, and Node alike.
- **Local is server-only** — `driver-local` uses `node:fs` streams and guards against path traversal.

## AWS SDK comparison

| | Fileway `@fileway/driver-s3` | `@aws-sdk/client-s3` |
| --- | --- | --- |
| Runtime dependencies | 1 (`@fileway/core`, itself zero-dep) | ~30 transitive packages |
| Bundle size | **~2 KB** min+gzip | ~85 KB min+gzip |
| Cloudflare Workers | Native — pure `fetch` + Web Crypto | Requires Node built-in shims/polyfills |
| Deno / Bun | Native | Partial — needs Node compatibility |
| Upload body | WHATWG `ReadableStream<Uint8Array>` | Node stream / `Buffer` internals |
| Setup | One driver, one `upload()` call | Service client, command classes, middleware config |
| Result typing | Inferred per driver (`meta.bucket`, `meta.etag`) | Manual typing of `PutObjectOutput` |
| Signature | Hand-rolled SigV4 (~100 lines, auditable) | Internal signing pipeline |

*Bundle sizes measured at time of writing: `driver-s3` built + minified + gzipped locally; `@aws-sdk/client-s3` v3.1099.0 from Bundlephobia.*

## Middleware

Hook into the upload lifecycle with `beforeUpload` (transform the stream or options) and `afterUpload` (post-processing):

```ts
import { FilewayClient } from "@fileway/core";
import { LocalDriver } from "@fileway/driver-local";

const client = new FilewayClient({
  driver: new LocalDriver({ directory: "./uploads" }),
  middlewares: [
    {
      async beforeUpload(stream, options) {
        console.log(`Uploading ${options.filename}...`);
        return { options: { ...options, path: options.path ?? "inbox" } };
      },
      async afterUpload(result) {
        console.log(`Done: ${result.path} (${result.size} bytes)`);
      },
    },
  ],
});
```

## Drivers

| Driver | Install | Notes |
| --- | --- | --- |
| `@fileway/driver-local` | `npm i @fileway/driver-local` | `directory`, optional `baseUrl`, `maxSizeBytes` |
| `@fileway/driver-s3` | `npm i @fileway/driver-s3` | AWS, MinIO, Cloudflare R2, any S3-compatible endpoint |
| `@fileway/driver-cloudinary` | `npm i @fileway/driver-cloudinary` | `cloudName`, `apiKey`, `apiSecret` |

```ts
// S3 — AWS, MinIO, or Cloudflare R2
const aws = new S3Driver({
  bucket: "my-bucket",
  region: "us-east-1",
  credentials: { accessKeyId: "...", secretAccessKey: "..." },
});

const minio = new S3Driver({
  bucket: "my-bucket",
  endpoint: "http://localhost:9000",
  forcePathStyle: true,
  credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
});

const r2 = new S3Driver({
  bucket: "my-bucket",
  endpoint: "https://<ACCOUNT_ID>.r2.cloudflarestorage.com",
  region: "auto",
  baseUrl: "https://pub-<HASH>.r2.dev",
  credentials: { accessKeyId: "...", secretAccessKey: "..." },
});

// Cloudinary
const cloudinary = new CloudinaryDriver({
  cloudName: "my-cloud",
  apiKey: "...",
  apiSecret: "...",
});
```

## API

### `client.upload(stream, options)`

| Parameter | Type | Description |
| --- | --- | --- |
| `stream` | `ReadableStream<Uint8Array>` | File data |
| `options.filename` | `string` | Original file name |
| `options.path` | `string` | Optional storage path prefix |
| `options.mimeType` | `string` | Optional MIME type |
| `options.metadata` | `Record<string, string>` | Optional metadata |
| `options.size` | `number` | Optional known byte size. For `S3Driver`, a known size ≤ 5 GiB enables bounded-memory `aws-chunked` streaming (no full buffering); unknown sizes or files > 5 GiB stream with bounded memory via multipart upload. |
| `options.signal` | `AbortSignal` | Optional `AbortSignal` to cancel an in-flight upload. Drivers reject with a `DOMException` named `AbortError` (via `abortError()` from `@fileway/core`); Local unlinks partial files and S3 aborts orphaned multipart sessions. |
| `options.onProgress` | `(p: UploadProgress) => void` | Optional progress callback: `{ bytes, total?, progress? }`. Fires as chunks flow through the stream — significant chunks (≥ 256 KiB or ≥ 5% of `total`) report immediately, smaller chunks coalesce to ~1 event per 100 ms, and an exact final event always fires. `total`/`progress` are present only when `options.size` is known. |

Returns `UploadResult<TMeta>` — `{ id, url, path, size, meta }` where `meta` is inferred from the driver.

### `client.get(path)` / `client.delete(path)` / `client.getUrl(path)` / `client.getPresignedUrl(path, options)`

- `get(path)` returns a WHATWG `ReadableStream<Uint8Array>` for streaming the stored file back — pull-based with backpressure, never buffered whole. Throws when `path` does not exist.
- `delete(path)` returns `Promise<boolean>`.
- `getUrl(path)` returns the public URL for a stored path.
- `getPresignedUrl(path, { expiresIn })` returns a time-limited, signed download URL on `S3Driver` (SigV4 query-string) and `CloudinaryDriver` (signed delivery URL). S3's `expiresIn` defaults to `3600` seconds and must be an integer in `1..604800` (AWS's 7-day cap); Cloudinary's must be a positive integer and defaults to `3600` — invalid values throw a `ValidationError`. Cloudinary signatures only restrict access for `authenticated`/`private` assets (see its driver docs). Drivers that cannot presign throw a clear error.

---

## Roadmap

**Toward v1.0.0** (see the [v1 release note](CHANGELOG.md#upcoming--v100)):

- [x] Streaming S3 uploads with per-chunk SigV4 signing (`aws-chunked`) — pass `options.size` to enable
- [x] Bounded-memory multipart uploads for S3 — automatic when the size is unknown or the object exceeds 5 GiB (`partSize`, `forceMultipart`)
- [x] Streaming downloads — `get(path)` returns a `ReadableStream<Uint8Array>` on every driver
- [x] Upload cancellation — `options.signal` on every driver; aborted uploads reject with `AbortError` (Local cleans up partial files, S3 aborts multipart sessions)
- [x] Upload progress — `options.onProgress` reports bytes streamed on every driver, with exact final totals when `size` is known
- [x] Presigned URLs — `getPresignedUrl(path, { expiresIn })` issues time-limited, signed download links for S3 (SigV4, works with MinIO/R2 endpoints) and Cloudinary (signed delivery URLs)
- [ ] Stream transformation in `beforeUpload` middlewares
- [ ] Retries with exponential backoff and classified errors

**Planned drivers:** Cloudflare R2 (native), Google Cloud Storage, Backblaze B2, Azure Blob Storage, DigitalOcean Spaces (S3-compatible).

## Community

- 💬 **Ask questions & share ideas** — [GitHub Discussions](https://github.com/Goldenhub/fileway/discussions)
- 🐛 **Report a bug** — open an [issue](https://github.com/Goldenhub/fileway/issues)
- ⭐ **Star the repo** to show support — it drives discovery
- 📦 **npm org** — [`@fileway` on npm](https://www.npmjs.com/org/fileway)

Contributions welcome: fork, branch off `main`, and open a PR. CI runs typecheck, unit tests, and MinIO integration tests on every push.

---

## CI & Releases

### Continuous integration

Every push to `main` and every pull request runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml): build → typecheck → unit tests across all four packages → S3 integration tests against a real MinIO server → docs typecheck.

### Releasing

Releases are fully automated. Bump, tag, push — GitHub publishes all four packages to npm:

```bash
pnpm -r version patch   # bumps all packages (0.0.5 -> 0.0.6)
git add -A && git commit -m "chore: release v0.0.6"
git tag v0.0.6
git push origin main --tags
```

[`.github/workflows/release.yml`](.github/workflows/release.yml) verifies every `package.json` version matches the tag, builds all packages, and runs `pnpm -r publish --access public --provenance`.

**No `NPM_TOKEN` is stored anywhere.** Publishing uses npm Trusted Publishers (OIDC): GitHub mints a short-lived identity token that npm exchanges for publish permission, and every release ships with SLSA provenance attestation.

## Development

```bash
pnpm install
pnpm build         # build all packages
pnpm typecheck     # typecheck all packages
pnpm test          # unit tests across all packages
pnpm test:integration  # S3 integration tests against local MinIO (Docker)
```

### Project structure

```
fileway/
├── packages/
│   ├── core/              # @fileway/core
│   ├── driver-local/      # @fileway/driver-local
│   ├── driver-s3/         # @fileway/driver-s3
│   └── driver-cloudinary/ # @fileway/driver-cloudinary
├── apps/
│   └── docs/              # Documentation site (Fumadocs + Next.js)
├── scripts/               # Manual test scripts
└── pnpm-workspace.yaml
```

## License

MIT © 2026 Azubuike Golden
