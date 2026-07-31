# @fileway/core

**Zero-dependency core of [Fileway](https://github.com/Goldenhub/fileway) — a runtime-agnostic file storage engine for JavaScript/TypeScript.**

`@fileway/core` provides the `FilewayClient`, the `BaseDriver` contract, and shared validation. It has no runtime dependencies and only uses platform standards: `ReadableStream<Uint8Array>`, `fetch`, `TextEncoder`. It runs on Node.js, Bun, Deno, and edge runtimes.

```bash
npm install @fileway/core
# plus at least one driver:
npm install @fileway/driver-local
```

## Quick start

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

Returns `UploadResult<TMeta>` — `id`, `url`, `path`, `size`, and `meta`. The `meta` shape is inferred from the driver you pass, so results stay fully typed.

### `delete(path)`

Returns `Promise<boolean>` — `true` if the file existed and was deleted.

### `getUrl(path)`

Returns `Promise<string>` — the public URL for the file.

## Middleware

Hook into the upload lifecycle:

```ts
const logger = {
  async afterUpload(result) {
    console.log(`Uploaded ${result.path} (${result.size} bytes)`);
  },
};

const client = new FilewayClient({ driver, middlewares: [logger] });
```

`beforeUpload` may transform the stream or options before the driver receives them; `afterUpload` runs after a successful upload.

## Building a custom driver

Implement `BaseDriver<TMeta>` and the rest of Fileway just works:

```ts
import type { BaseDriver, UploadOptions, UploadResult } from "@fileway/core";

class MyDriver implements BaseDriver<{ disk: string }> {
  readonly name = "my-driver";

  async upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
  ): Promise<UploadResult<{ disk: string }>> {
    /* ... */
  }

  async delete(path: string): Promise<boolean> {
    /* ... */
  }

  async getUrl(path: string): Promise<string> {
    /* ... */
  }
}
```

## Resources

- [Documentation](https://github.com/Goldenhub/fileway)
- [License: MIT](https://github.com/Goldenhub/fileway/blob/main/LICENSE)
