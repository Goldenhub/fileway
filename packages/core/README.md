# @fileway/core

[![npm version](https://img.shields.io/npm/v/@fileway/core?style=flat-square)](https://www.npmjs.com/package/@fileway/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@fileway/core?style=flat-square)](https://bundlephobia.com/package/@fileway/core)

**Zero-dependency core of [Fileway](https://github.com/Goldenhub/fileway), a runtime-agnostic file storage engine for JavaScript/TypeScript.**

`@fileway/core` provides the `FilewayClient`, the `BaseDriver` contract, and shared validation. It has no runtime dependencies and only uses platform standards: `ReadableStream<Uint8Array>`, `fetch`, `TextEncoder`. It runs on Node.js, Bun, Deno, and edge runtimes.

```bash
npm install @fileway/core
# plus at least one driver:
npm install @fileway/local
```

## Quick start

```ts
import { FilewayClient } from "@fileway/core";
import { LocalDriver } from "@fileway/local";

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
// result: { id, url, path, size, meta }

// Public URL + delete
const url = await client.getUrl(result.path);
const deleted = await client.delete(result.path);
```

## API

### `upload(stream, options)`

| Parameter          | Type                         | Description                     |
| ------------------ | ---------------------------- | ------------------------------- |
| `stream`           | `ReadableStream<Uint8Array>` | File data                       |
| `options.filename` | `string`                     | Original file name              |
| `options.path`     | `string`                     | Optional storage path prefix    |
| `options.mimeType` | `string`                     | Optional MIME type              |
| `options.metadata` | `Record<string, string>`     | Optional metadata (driver-dependent) |

Returns `UploadResult<TMeta>`: `id`, `url`, `path`, `size`, and `meta`. The `meta` shape is inferred from the driver you pass, so results stay fully typed.

### `delete(path, options?)`

Returns `Promise<void>`. Deleting a file that does not exist is not an error; other failures throw a `StorageError`.

### `getUrl(path, options?)`

Returns `Promise<string>`: the public URL for the file.

`get`, `delete`, `getUrl` and `getPresignedUrl` accept `{ signal }` (cancels the request in flight and any retries) plus the driver's own options, if it has any.

## Middleware

Hook into the upload lifecycle:

```ts
const logger: MiddlewareHook = {
  async afterUpload(result, options) {
    console.log(`Uploaded ${options.filename} to ${result.path} (${result.size} bytes)`);
  },
};

const client = new FilewayClient({ driver, middlewares: [logger] });
```

`beforeUpload` may transform the stream or options before the driver receives them; `afterUpload` runs after a successful upload, with the result and the options the driver received. Written inline in the client config, `afterUpload` gets the driver's `meta` type.

## Building a custom driver

Implement `BaseDriver<TMeta>` and the rest of Fileway just works:

```ts
import type { BaseDriver, OperationOptions, UploadContext, UploadOptions, UploadResult } from "@fileway/core";

type MyMeta = { disk: string };

class MyDriver implements BaseDriver<MyMeta> {
  readonly name = "my-driver";

  async upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
    context?: UploadContext, // store context.uploadToken with the object if you can
  ): Promise<UploadResult<MyMeta>> {
    /* ... */
  }

  async delete(path: string, options?: OperationOptions): Promise<void> {
    /* a missing object is not an error; pass options.signal to fetch */
  }

  async getUrl(path: string, options?: OperationOptions): Promise<string> {
    /* ... */
  }

  async get(path: string, options?: OperationOptions): Promise<ReadableStream<Uint8Array>> {
    /* ... */
  }
}
```

## Resources

- [Documentation](https://github.com/Goldenhub/fileway)
- [License: MIT](https://github.com/Goldenhub/fileway/blob/main/LICENSE)
