# @fileway/driver-s3

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
| `forcePathStyle`    | `boolean`                            | Reserved for future path-style requests        |
| `baseUrl`           | `string`                             | Public base URL (e.g. R2 custom domain)        |

## MinIO

```ts
new S3Driver({
  bucket: "my-bucket",
  endpoint: "http://localhost:9000",
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
