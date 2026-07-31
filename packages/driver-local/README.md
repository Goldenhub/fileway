# @fileway/driver-local

[![npm version](https://img.shields.io/npm/v/@fileway/driver-local?style=flat-square)](https://www.npmjs.com/package/@fileway/driver-local)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@fileway/driver-local?style=flat-square)](https://bundlephobia.com/package/@fileway/driver-local)

**Local filesystem driver for [Fileway](https://github.com/Goldenhub/fileway).**

Stores uploads on disk using native Node.js streams. This is the only driver that streams files end-to-end without buffering the whole file in memory.

```bash
npm install @fileway/driver-local
```

## Usage

```ts
import { FilewayClient } from "@fileway/core";
import { LocalDriver } from "@fileway/driver-local";

const driver = new LocalDriver({
  directory: "./uploads",
  baseUrl: "https://cdn.example.com/files", // optional, defaults to file://<directory>
  maxSizeBytes: 10 * 1024 * 1024, // optional upload size limit
});

const client = new FilewayClient({ driver });

const result = await client.upload(stream, { filename: "photo.jpg", path: "avatars" });
console.log(result.path, result.size);
```

## Config

| Option          | Type     | Default              | Description                            |
| --------------- | -------- | -------------------- | -------------------------------------- |
| `directory`     | `string` | required             | Storage directory (created on upload)  |
| `baseUrl`       | `string` | `file://<directory>` | Public base URL for generated URLs     |
| `maxSizeBytes`  | `number` | unlimited            | Rejects uploads larger than this size  |

## Security

Paths are validated against the configured `directory` — uploads that would escape it (e.g. via `path: "../..")` throw a `ValidationError`.

## Runtime

Node.js and Bun only (uses `node:fs` / `node:stream`).

## Resources

- [Documentation](https://github.com/Goldenhub/fileway)
- [License: MIT](https://github.com/Goldenhub/fileway/blob/main/LICENSE)
