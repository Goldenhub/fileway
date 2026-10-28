# @fileway/azure

[![npm version](https://img.shields.io/npm/v/@fileway/azure?style=flat-square)](https://www.npmjs.com/package/@fileway/azure)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@fileway/azure?style=flat-square)](https://bundlephobia.com/package/@fileway/azure)

**Azure Blob Storage driver for [Fileway](https://github.com/Goldenhub/fileway).**

Implemented with `fetch` and Web Crypto (Shared Key and SAS signing): no Azure SDK required, so it runs on Node.js, Bun, Deno, and edge runtimes.

```bash
npm install @fileway/azure
```

## Usage

```ts
import { FilewayClient } from "@fileway/core";
import { AzureDriver } from "@fileway/azure";

const driver = new AzureDriver({
  container: "uploads",
  accountName: "mystorageaccount",
  accountKey: process.env.AZURE_STORAGE_KEY,
});

const client = new FilewayClient({ driver });

const result = await client.upload(stream, {
  filename: "photo.jpg",
  metadata: { userId: "42" }, // stored as x-ms-meta-*
});
// result.meta.container, result.meta.etag
```

Or pass a connection string from the Azure portal:

```ts
new AzureDriver({ container: "uploads", connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING });
```

## Config

| Option             | Type     | Description |
| ------------------ | -------- | ----------- |
| `container`        | `string` | Container name (required) |
| `accountName`      | `string` | Storage account name |
| `accountKey`       | `string` | Account key (Shared Key auth; also needed for presigned URLs) |
| `sasToken`         | `string` | A SAS token, used instead of an account key |
| `connectionString` | `string` | Connection string; explicit options override its values. `UseDevelopmentStorage=true` targets Azurite |
| `endpoint`         | `string` | Blob service endpoint (default `https://<account>.blob.core.windows.net`) |
| `baseUrl`          | `string` | Public base URL for `getUrl` (e.g. a CDN) |
| `blockSize`        | `number` | Block size in bytes (default `8 MiB`, range `1 MiB` to `4000 MiB`) |
| `maxSizeBytes`     | `number` | Reject larger uploads with a `size-exceeded` error |

## Upload strategy

The stream is read one block at a time, so memory stays bounded by `blockSize` whatever the file size:

- **Fits in one block**: a single `Put Blob`.
- **Larger, or unknown size**: `Put Block` for each block, then `Put Block List` to commit them. Blocks staged by a failed or cancelled upload are never visible and Azure discards them after 7 days.

If the stream ends before or after a declared `size`, nothing is committed and the upload throws a validation error.

## Metadata

Azure metadata names must be valid identifiers (letters, digits and underscores, not starting with a digit), so keys like `user-id` throw a validation error. Use `userId` or `user_id`.

## Upload status

`pathFor`, `head` and `isPending` are implemented, so `client.getUploadStatus()` reports `complete`, `pending` (blocks staged, not committed) or `missing`, and lost upload responses are recovered without uploading twice.

## Azurite

```ts
new AzureDriver({ container: "uploads", connectionString: "UseDevelopmentStorage=true" });
```

## Resources

- [Documentation](https://www.usefileway.dev/docs/drivers/azure)
- [License: MIT](https://github.com/Goldenhub/fileway/blob/main/LICENSE)
