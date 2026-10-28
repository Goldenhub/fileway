# @fileway/gcs

[![npm version](https://img.shields.io/npm/v/@fileway/gcs?style=flat-square)](https://www.npmjs.com/package/@fileway/gcs)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@fileway/gcs?style=flat-square)](https://bundlephobia.com/package/@fileway/gcs)

**Google Cloud Storage driver for [Fileway](https://github.com/Goldenhub/fileway).**

Implemented with `fetch` and Web Crypto (service account JWTs and V4 signed URLs): no Google SDK required, so it runs on Node.js, Bun, Deno, and edge runtimes.

```bash
npm install @fileway/gcs
```

## Usage

```ts
import { FilewayClient } from "@fileway/core";
import { GCSDriver } from "@fileway/gcs";

const driver = new GCSDriver({
  bucket: "my-bucket",
  serviceAccount: process.env.GCS_SERVICE_ACCOUNT_JSON, // contents of the key file
});

const client = new FilewayClient({ driver });

const result = await client.upload(stream, {
  filename: "photo.jpg",
  metadata: { userId: "42" }, // stored as custom object metadata
});
// result.meta.bucket, result.meta.generation, result.meta.md5Hash
```

On Google Cloud (Cloud Run, GKE with Workload Identity) you can pass a token function instead of a key:

```ts
new GCSDriver({
  bucket: "my-bucket",
  getAccessToken: async () => {
    const res = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" } },
    );
    return (await res.json()).access_token;
  },
});
```

## Config

| Option           | Type     | Description |
| ---------------- | -------- | ----------- |
| `bucket`         | `string` | Bucket name (required) |
| `serviceAccount` | `string \| object` | Service account JSON key (file contents or parsed object) |
| `credentials`    | `{ clientEmail, privateKey }` | The same key as separate fields |
| `getAccessToken` | `() => Promise<string>` | Supplies an OAuth token instead of a key |
| `endpoint`       | `string` | API endpoint (default `https://storage.googleapis.com`) |
| `baseUrl`        | `string` | Public base URL for `getUrl` (e.g. a CDN) |
| `chunkSize`      | `number` | Resumable chunk size in bytes (default `8 MiB`, multiple of `256 KiB`) |
| `maxSizeBytes`   | `number` | Reject larger uploads with a `size-exceeded` error |

One of `serviceAccount`, `credentials` or `getAccessToken` is required. Access tokens are cached and refreshed shortly before they expire.

## Upload strategy

The stream is read one chunk at a time, so memory stays bounded by `chunkSize` whatever the file size:

- **Fits in one chunk**: a single `multipart/related` request with the metadata and content.
- **Larger, or unknown size**: a resumable upload session, one `PUT` per chunk. A failed or cancelled upload deletes its session, so nothing partial is stored.

If the stream ends before or after a declared `size`, the session is cancelled and the upload throws a validation error.

## Presigned URLs

`getPresignedUrl()` returns a V4 signed URL (up to 7 days). It needs the service account key (`serviceAccount` or `credentials`), not `getAccessToken`.

## Upload status

`pathFor` and `head` are implemented, so `client.getUploadStatus()` reports `complete` or `missing`, and lost upload responses are recovered without uploading twice. Resumable sessions cannot be listed, so `pending` is not reported.

## Resources

- [Documentation](https://www.usefileway.dev/docs/drivers/gcs)
- [License: MIT](https://github.com/Goldenhub/fileway/blob/main/LICENSE)
