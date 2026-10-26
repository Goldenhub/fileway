# @fileway/cloudinary

[![npm version](https://img.shields.io/npm/v/@fileway/cloudinary?style=flat-square)](https://www.npmjs.com/package/@fileway/cloudinary)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@fileway/cloudinary?style=flat-square)](https://bundlephobia.com/package/@fileway/cloudinary)

**Cloudinary driver for [Fileway](https://github.com/Goldenhub/fileway): uploads via `fetch` + `FormData`, no SDK.**

Pure Web Platform APIs (`fetch`, `FormData`, `Blob`, Web Crypto for signing), so it runs on Node.js, Bun, Deno, and edge runtimes.

```bash
npm install @fileway/cloudinary
```

## Usage

```ts
import { FilewayClient } from "@fileway/core";
import { CloudinaryDriver } from "@fileway/cloudinary";

const driver = new CloudinaryDriver({
  cloudName: "my-cloud",
  apiKey: "...",
  apiSecret: "...",
  maxSizeBytes: 10 * 1024 * 1024, // optional
});

const client = new FilewayClient({ driver });

const result = await client.upload(stream, {
  filename: "photo.jpg",
  path: "avatars", // maps to the Cloudinary folder
});
// result.meta: { publicId, version, format, resourceType, bytes, secureUrl, width?, height? }
```

## Config

| Option            | Type     | Default   | Description                              |
| ----------------- | -------- | --------- | ---------------------------------------- |
| `cloudName`       | `string` | required  | Your Cloudinary cloud name               |
| `apiKey`          | `string` | required  | Cloudinary API key                       |
| `apiSecret`       | `string` | required  | Cloudinary API secret (used for signing) |
| `defaultFolder`   | `string` | n/a         | Reserved for future use                  |
| `maxSizeBytes`    | `number` | unlimited | Rejects uploads larger than this size (`size-exceeded`) |
| `chunkSize`       | `number` | 20 MiB    | Chunk size for chunked uploads (min 5 MiB) |
| `cacheSize`       | `number` | 1000      | Max cached asset lookups (LRU)           |
| `deliveryType`    | `"upload" \| "authenticated" \| "private"` | `"upload"` | Delivery type for uploads; `getUrl` signs non-public assets |

## Resources

- [Documentation](https://github.com/Goldenhub/fileway)
- [License: MIT](https://github.com/Goldenhub/fileway/blob/main/LICENSE)
