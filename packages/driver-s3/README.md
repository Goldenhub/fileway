# @fileway/driver-s3

[![npm version](https://img.shields.io/npm/v/@fileway/driver-s3?style=flat-square)](https://www.npmjs.com/package/@fileway/driver-s3)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@fileway/driver-s3?style=flat-square)](https://bundlephobia.com/package/@fileway/driver-s3)

**S3 driver for [Fileway](https://github.com/Goldenhub/fileway) — AWS S3 and S3-compatible storage (MinIO, Cloudflare R2).**

Implemented with `fetch` and hand-rolled SigV4 — no AWS SDK required, so it runs on Node.js, Bun, Deno, and edge runtimes.

```bash
npm install @fileway/driver-s3
```

## Usage

```ts
import { FilewayClient } from "@fileway/core";
import { S3Driver } from "@fileway/driver-s3";

const driver = new S3Driver({
  bucket: "my-bucket",
  region: "us-east-1",
  credentials: { accessKeyId: "...", secretAccessKey: "..." },
});

const client = new FilewayClient({ driver });

const result = await client.upload(stream, {
  filename: "photo.jpg",
  metadata: { userId: "42" }, // stored as x-amz-meta-*
});
// result.meta.bucket, result.meta.etag
```

## Config

| Option              | Type                                 | Description                                    |
| ------------------- | ------------------------------------ | ---------------------------------------------- |
| `bucket`            | `string`                             | Bucket name (required)                         |
| `region`            | `string`                             | AWS region (default `us-east-1`)               |
| `credentials`       | `{ accessKeyId, secretAccessKey }`   | AWS credentials (required)                     |
| `endpoint`          | `string`                             | Custom endpoint for MinIO / R2                 |
| `forcePathStyle`    | `boolean`                            | Use path-style URLs (`endpoint/bucket/...`) — required for MinIO |
| `baseUrl`           | `string`                             | Public base URL (e.g. R2 custom domain)        |
| `partSize`          | `number`                             | Multipart part size in bytes (default `8 MiB`, minimum `5 MiB`) |
| `forceMultipart`    | `boolean`                            | Always use multipart uploads, regardless of size |

## Upload strategy

The driver picks the S3 upload strategy automatically from `options.size`:

- **Known size ≤ 5 GiB** — single `PUT` with a SigV4 `aws-chunked` body; chunks are signed lazily as the stream is read, so memory stays constant.
- **Unknown size** — multipart upload (`CreateMultipartUpload` → `UploadPart` → `CompleteMultipartUpload`) that reads the stream into part-sized buffers (default `8 MiB`), so peak memory stays bounded.
- **Size > 5 GiB** — multipart upload, since a single `PUT` cannot exceed 5 GiB.

If the stream ends before or after a declared `size`, the upload is aborted and throws a validation error — nothing is stored.

## MinIO

```ts
new S3Driver({
  bucket: "my-bucket",
  endpoint: "http://localhost:9000",
  forcePathStyle: true,
  credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
});
```

## Cloudflare R2

```ts
new S3Driver({
  bucket: "my-bucket",
  endpoint: "https://<accountid>.r2.cloudflarestorage.com",
  region: "auto",
  baseUrl: "https://pub-<hash>.r2.dev",
  credentials: { accessKeyId: "...", secretAccessKey: "..." },
});
```

## Resources

- [Documentation](https://github.com/Goldenhub/fileway)
- [License: MIT](https://github.com/Goldenhub/fileway/blob/main/LICENSE)
