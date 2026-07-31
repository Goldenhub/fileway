# Fileway

[![CI](https://img.shields.io/github/actions/workflow/status/Goldenhub/fileway/ci.yml?branch=main&style=flat-square)](https://github.com/Goldenhub/fileway/actions)
[![npm version](https://img.shields.io/npm/v/@fileway/core?style=flat-square)](https://www.npmjs.com/package/@fileway/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@fileway/core?style=flat-square)](https://bundlephobia.com/package/@fileway/core)

**Runtime-agnostic file storage engine for JavaScript/TypeScript.**

Fileway is a thin, type-safe wrapper around any storage backend. Upload files via `ReadableStream<Uint8Array>`, get back typed results. Swap drivers without changing your application code.

```ts
import { FilewayClient } from "@fileway/core";
import { S3Driver } from "@fileway/driver-s3";

const client = new FilewayClient({
  driver: new S3Driver({ bucket: "my-bucket", region: "us-east-1" }),
});

const result = await client.upload(stream, { filename: "photo.jpg" });
//    ^ result.meta.bucket — inferred from driver type
```

---

## Packages

| Package                      | Description                      | Dependencies | Runtime       |
| ---------------------------- | -------------------------------- | ------------ | ------------- |
| `@fileway/core`              | Client engine, types, validation | Zero         | Universal     |
| `@fileway/driver-local`      | Local filesystem storage         | `node:fs`    | Node.js / Bun |
| `@fileway/driver-s3`         | AWS S3 & compatible (MinIO, R2)  | AWS SDK v3   | Universal     |
| `@fileway/driver-cloudinary` | Cloudinary uploads via Fetch API | Zero         | Universal     |

## Features

- **Zero-core-deps** — `@fileway/core` has no runtime dependencies.
- **Streaming** — Files transfer via WHATWG `ReadableStream<Uint8Array>`. No buffering entire files in memory.
- **Type inference** — Each driver returns its own metadata shape automatically.
- **Middleware pipeline** — Hook into upload lifecycle (`beforeUpload`, `afterUpload`).
- **All runtimes** — Works on Node.js, Bun, Deno, Cloudflare Workers, and edge environments.
- **Dual module** — Published as both ESM (`.js`) and CJS (`.cjs`) with TypeScript declarations.

## Install

```bash
npm install @fileway/core
# Add a driver:
npm install @fileway/driver-s3
```

## Usage

```ts
import { FilewayClient } from "@fileway/core";
import { LocalDriver } from "@fileway/driver-local";

const client = new FilewayClient({
  driver: new LocalDriver({ directory: "./storage" }),
});

// Upload a stream
const result = await client.upload(
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("file content"));
      controller.close();
    },
  }),
  { filename: "readme.txt", path: "docs", mimeType: "text/plain" },
);

// Get a public URL
const url = await client.getUrl(result.path);

// Delete
const deleted = await client.delete(result.path);
```

## Drivers

### Local

```ts
import { LocalDriver } from "@fileway/driver-local";

const driver = new LocalDriver({
  directory: "./uploads",
  baseUrl: "https://cdn.example.com/files", // optional, defaults to file://
  maxSizeBytes: 10 * 1024 * 1024, // optional
});
```

### S3 (AWS, MinIO, Cloudflare R2)

```ts
import { S3Driver } from "@fileway/driver-s3";

// AWS
const aws = new S3Driver({
  bucket: "my-bucket",
  region: "us-east-1",
  credentials: { accessKeyId: "...", secretAccessKey: "..." },
});

// MinIO
const minio = new S3Driver({
  bucket: "my-bucket",
  endpoint: "http://localhost:9000",
  forcePathStyle: true,
  credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
});

// Cloudflare R2
const r2 = new S3Driver({
  bucket: "my-bucket",
  endpoint: "https://<accountid>.r2.cloudflarestorage.com",
  region: "auto",
  baseUrl: "https://pub-<hash>.r2.dev", // optional
  credentials: { accessKeyId: "...", secretAccessKey: "..." },
});
```

### Cloudinary

```ts
import { CloudinaryDriver } from "@fileway/driver-cloudinary";

const driver = new CloudinaryDriver({
  cloudName: "my-cloud",
  apiKey: "...",
  apiSecret: "...",
  maxSizeBytes: 10 * 1024 * 1024, // optional
});
```

## Middleware

```ts
const logger = {
  async afterUpload(result) {
    console.log(`Uploaded ${result.path} (${result.size} bytes)`);
  },
};

const client = new FilewayClient({ driver, middlewares: [logger] });
```

## API

### `client.upload(stream, options)`

| Parameter          | Type                         | Description                  |
| ------------------ | ---------------------------- | ---------------------------- |
| `stream`           | `ReadableStream<Uint8Array>` | File data                    |
| `options.filename` | `string`                     | Original file name           |
| `options.path`     | `string`                     | Optional storage path prefix |
| `options.mimeType` | `string`                     | Optional MIME type           |
| `options.metadata` | `Record<string, string>`     | Optional metadata            |

Returns `UploadResult<TMeta>` — includes `id`, `url`, `path`, `size`, `meta`.

### `client.delete(path)`

Returns `Promise<boolean>` — `true` if the file existed and was deleted.

### `client.getUrl(path)`

Returns `Promise<string>` — public URL for the file.

## CI & Releases

### Continuous integration

Every push to `main` and every pull request runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

- Typecheck all packages and the docs site
- Build all packages
- Unit tests across all four packages
- S3 integration tests against a real MinIO server (Docker service container)
- Docs typecheck

### Releasing

Releases are fully automated. Bump the versions, tag, and push — GitHub publishes all four packages to npm:

```bash
pnpm -r version patch   # bumps all packages (0.0.3 -> 0.0.4)
git add -A && git commit -m "chore: release v0.0.4"
git tag v0.0.4
git push origin main --tags
```

[`.github/workflows/release.yml`](.github/workflows/release.yml) then:

1. Verifies every `package.json` version matches the tag (`v0.0.4` -> `0.0.4`)
2. Builds all packages
3. Runs `pnpm -r publish --access public --provenance`

**No `NPM_TOKEN` is stored anywhere.** Publishing uses **npm Trusted Publishers (OIDC)**: GitHub mints a short-lived identity token that npm exchanges for publish permission, and every release ships with SLSA provenance attestation (cryptographic proof of build origin).

One-time npm setup (per package, on the package's npm page → Settings → **Trusted Publisher** → GitHub Actions):

| Field              | Value          |
| ------------------ | -------------- |
| Organization / user| `Goldenhub`    |
| Repository         | `fileway`      |
| Workflow filename  | `release.yml`  |
| Environment name   | *(blank)*      |
| Allowed actions    | `npm publish`  |

## Development

```bash
# Install
pnpm install

# Build all packages
pnpm build

# Typecheck all packages
pnpm typecheck

# Run tests across all packages
pnpm test

# S3 integration tests against a local MinIO (needs Docker running)
pnpm test:integration

# Test a driver manually
pnpm test:local
S3_BUCKET=my-bucket S3_ENDPOINT=http://localhost:9000 MINIO_ACCESS_KEY=minioadmin MINIO_SECRET_KEY=minioadmin pnpm test:s3:minio
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

MIT
