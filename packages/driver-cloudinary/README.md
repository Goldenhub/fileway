# @fileway/driver-cloudinary

[![npm version](https://img.shields.io/npm/v/@fileway/driver-cloudinary?style=flat-square)](https://www.npmjs.com/package/@fileway/driver-cloudinary)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@fileway/driver-cloudinary?style=flat-square)](https://bundlephobia.com/package/@fileway/driver-cloudinary)

**Cloudinary driver for [Fileway](https://github.com/Goldenhub/fileway) — uploads via `fetch` + `FormData`, no SDK.**

Pure Web Platform APIs (`fetch`, `FormData`, `Blob`, Web Crypto for signing), so it runs on Node.js, Bun, Deno, and edge runtimes.

```bash
npm install @fileway/driver-cloudinary
```

## Usage

```ts
import { FilewayClient } from "@fileway/core";
import { CloudinaryDriver } from "@fileway/driver-cloudinary";

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
| `defaultFolder`   | `string` | —         | Reserved for future use                  |
| `maxSizeBytes`    | `number` | unlimited | Rejects uploads larger than this size    |

## Resources

- [Documentation](https://github.com/Goldenhub/fileway)
- [License: MIT](https://github.com/Goldenhub/fileway/blob/main/LICENSE)
