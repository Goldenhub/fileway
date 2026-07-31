# AGENTS.md — AI Agent Task & Engineering Guidelines

> **System Context:** You are an elite Systems Architect and Senior TypeScript Engineer assigned to build **Fileway**, an open-source, runtime-agnostic file storage engine for the JavaScript/TypeScript ecosystem.

---

## 🎯 Task Objective

Implement Phase 1 and Phase 2 of the Fileway monorepo:

1. Initialize `@fileway/core` with zero production dependencies, standard WHATWG Web Stream interfaces, and dynamic type inference.
2. Build `@fileway/driver-local` using native Node.js streams to handle local filesystem storage.
3. Write comprehensive unit and integration tests using `vitest` to verify stream uploads and middleware execution.

---

## 📐 Key Constraints & Rules

1. **Zero Core Dependencies:** The `@fileway/core` package MUST NOT have any external runtime dependencies.
2. **Web Streams Standard:** Always use `ReadableStream<Uint8Array>` for file streaming across the architecture. Avoid buffering whole files into memory (`Buffer.from()`).
3. **Strict Type Safety:** Use strict TypeScript flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Never return `any` types.
4. **Dual Module Compilation:** Build all packages using `tsup` targeting both CommonJS (`.cjs`) and ES Modules (`.js`) with TypeScript declarations (`.d.ts`).
5. **Workspace Linking:** Link internal packages inside `package.json` using `"@fileway/core": "workspace:*"`.
6. **Universal Cross-Runtime Drivers:** `@fileway/core`, `@fileway/driver-s3`, and `@fileway/driver-cloudinary` MUST contain ZERO Node-built-in imports (`node:*`). Use only WHATWG `ReadableStream<Uint8Array>`, `fetch`, `FormData`, `Blob`, `globalThis.crypto.subtle`, `TextEncoder`, and `TextDecoder`.
7. **Server-Only Packages:** `@fileway/driver-local` may use `node:fs` / `node:stream` but should fail gracefully in environments without filesystem access.

---

## 🛠️ Reference Architectures & Code Contracts

### 1. Core Interfaces (`packages/core/src/types.ts`)

```typescript
export interface UploadOptions {
  filename: string;
  mimeType?: string;
  path?: string;
  metadata?: Record<string, string>;
}

export interface UploadResult<TMeta Record<string, unknown>> {
  id: string;
  url: string;
  path: string;
  size: number;
  meta: TMeta;
}

export interface BaseDriver<TMeta Record<string, unknown>> {
  name: string;
  upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions
  ): Promise<UploadResult<TMeta>>;
  delete(path: string): Promise<boolean>;
  getUrl(path: string): Promise<string>;
}

export interface MiddlewareHook {
  beforeUpload?: (
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions
  ) => Promise<{ stream?: ReadableStream<Uint8Array>; options?: UploadOptions } | void>;
  afterUpload?: (result: UploadResult) => Promise<void>;
}

export interface FilewayConfig<TDriver BaseDriver="BaseDriver" extends> {
  driver: TDriver;
  middlewares?: MiddlewareHook[];
}
```

### 2 Client Engine (packages/core/src/index.ts)

```typescript
import { BaseDriver, FilewayConfig, UploadOptions } from "./types";

export * from "./types";

export class FilewayClient<const TConfig extends FilewayConfig> {
  private driver: TConfig["driver"];
  private middlewares: NonNullable<FilewayConfig["middlewares"]>;

  constructor(config: TConfig) {
    this.driver = config.driver;
    this.middlewares = config.middlewares ?? [];
  }

  async upload(stream: ReadableStream<Uint8Array>, options: UploadOptions): Promise<ReturnType<TConfig["driver"]["upload"]>> {
    let activeStream = stream;
    let activeOptions = { ...options };

    for (const middleware of this.middlewares) {
      if (middleware.beforeUpload) {
        const result = await middleware.beforeUpload(activeStream, activeOptions);
        if (result?.stream) activeStream = result.stream;
        if (result?.options) activeOptions = result.options;
      }
    }

    const uploadResult = await this.driver.upload(activeStream, activeOptions);

    for (const middleware of this.middlewares) {
      if (middleware.afterUpload) {
        await middleware.afterUpload(uploadResult);
      }
    }

    return uploadResult as ReturnType<TConfig["driver"]["upload"]>;
  }

  async delete(path: string): Promise<boolean> {
    return this.driver.delete(path);
  }

  async getUrl(path: string): Promise<string> {
    return this.driver.getUrl(path);
  }
}

---

## Implementation Roadmap & Milestones

- [x] **Phase 1: Core Contract & Type Mechanics** — Implement zero-dependency core types and FilewayClient. Validate clean ESM/CJS build output via tsup.
- [x] **Phase 2: Local & S3 Driver Implementations** — Build @fileway/driver-local using node:fs streams. Build @fileway/driver-s3 using @aws-sdk/lib-storage for multipart Web Stream uploads.
- [ ] **Phase 3: Middleware Execution Pipeline** — Implement stream transformation in beforeUpload. Implement post-processing triggers in afterUpload.
- [x] **Phase 4: Multi-Runtime Test Coverage** — Configure vitest unit tests across all sub-packages. Test compatibility on Node.js, Bun, and Edge worker environments.
- [x] **Phase 5: Documentation & Open-Source Distribution** — Scaffold apps/docs with code-first usage examples via Fumadocs + Next.js 16. Publish @fileway workspace packages to npm (not yet done).

## Cross-Runtime Refactor (Complete)

- [x] **Audit Node imports** — All `node:*` imports eliminated from universal packages (`core`, `driver-cloudinary`, `driver-s3`). Only `driver-local` retains `node:fs`/`node:path`/`node:stream`.
- [x] **Refactor `driver-cloudinary`** — Replaced `cloudinary` SDK + `Readable.fromWeb()` with pure `fetch` + `FormData` + `crypto.subtle.digest("SHA-1")`. Zero deps beyond `@fileway/core`.
- [x] **Refactor `driver-s3`** — Replaced `@aws-sdk/lib-storage` + `Readable.fromWeb()` with pure `fetch` + Web Crypto. SigV4 is hand-rolled; streams are sent directly as WHATWG `ReadableStream` bodies.
- [x] **Remove edge duplicates** — `driver-cloudinary-edge` and `driver-s3-edge` deleted; their functionality is now in the universal `driver-cloudinary` and `driver-s3`.
- [x] **Conditional exports** — All packages declare `worker`, `deno`, `bun`, `import`, `require` in `exports` map.
- [x] **Edge-runtime tests** — `@fileway/core` and `@fileway/driver-cloudinary` run vitest with `environment: "edge-runtime"` via `@edge-runtime/vm`.
- [x] **All builds & tests pass** — 40 unit tests across 4 packages, plus 5 S3 integration tests against MinIO.

## Current Packages

| Package | Node deps | Runtime | Tests |
|---|---|---|---|
| `@fileway/core` | None | Universal | 5 |
| `@fileway/driver-local` | `node:fs`, `node:path`, `node:stream` | Node.js, Bun | 5 |
| `@fileway/driver-s3` | None (pure fetch + Web Crypto SigV4) | Universal | 22 |
| `@fileway/driver-cloudinary` | None | Universal | 8 |

## Relevant Files

- `AGENTS.md`: project spec, roadmap, agent rules, reference architecture
- `packages/core/src/types.ts`: core interfaces (BaseDriver, UploadOptions, UploadResult, MiddlewareHook, FilewayConfig)
- `packages/core/src/index.ts`: FilewayClient class
- `packages/driver-local/src/index.ts`: LocalDriver (node:fs)
- `packages/driver-s3/src/index.ts`: S3Driver (pure fetch + Web Crypto SigV4, aws-chunked streaming + multipart)
- `packages/driver-cloudinary/src/index.ts`: CloudinaryDriver (pure fetch, FormData, Web Crypto)
- `apps/docs/`: Fumadocs + Next.js 16 documentation site
- `pnpm-workspace.yaml`: workspace config, catalog
