# @fileway/supabase

[![npm version](https://img.shields.io/npm/v/@fileway/supabase?style=flat-square)](https://www.npmjs.com/package/@fileway/supabase)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@fileway/supabase?style=flat-square)](https://bundlephobia.com/package/@fileway/supabase)

**Supabase Storage driver for [Fileway](https://github.com/Goldenhub/fileway).**

Implemented with `fetch` against the Storage REST and TUS APIs: no `supabase-js` required, so it runs on Node.js, Bun, Deno, and edge runtimes.

```bash
npm install @fileway/supabase
```

## Usage

```ts
import { FilewayClient } from "@fileway/core";
import { SupabaseDriver } from "@fileway/supabase";

// Server side, with a secret (service role) key: full access, bypasses RLS.
const driver = new SupabaseDriver({
  url: "https://<project-ref>.supabase.co",
  key: process.env.SUPABASE_SECRET_KEY,
  bucket: "avatars",
});

const client = new FilewayClient({ driver });

const result = await client.upload(stream, {
  filename: "photo.jpg",
  metadata: { userId: "42" }, // stored as the object's user metadata
});
```

To act as a signed-in user so the bucket's RLS policies apply, pass the anon or publishable key plus the user's access token:

```ts
new SupabaseDriver({
  url: "https://<project-ref>.supabase.co",
  key: process.env.SUPABASE_PUBLISHABLE_KEY,
  accessToken: session.access_token,
  bucket: "avatars",
});
```

## Config

| Option         | Type     | Description |
| -------------- | -------- | ----------- |
| `url`          | `string` | Project URL (required). `https://<ref>.storage.supabase.co` is faster for large uploads |
| `key`          | `string` | API key (required): secret / service role, or anon / publishable with `accessToken` |
| `accessToken`  | `string` | A user's JWT, so RLS policies apply |
| `bucket`       | `string` | Bucket name (required) |
| `baseUrl`      | `string` | Public base URL for `getUrl` (default: the bucket's public object URL) |
| `cacheControl` | `number` | `Cache-Control` max-age in seconds (default `3600`) |
| `maxSizeBytes` | `number` | Reject larger uploads with a `size-exceeded` error |

## Upload strategy

Uploads always overwrite (`x-upsert`) and memory stays bounded whatever the file size:

- **Up to 6 MiB**: one standard upload request.
- **Known size above 6 MiB**: a resumable TUS upload in 6 MiB chunks (the size Supabase requires). A failed or cancelled upload is terminated.
- **Unknown size above 6 MiB**: the stream is sent as the body of one standard upload, without buffering it. Supabase limits standard uploads to 5 GB, so pass `size` for larger files.

If the stream ends before or after a declared `size`, the upload throws a validation error and nothing is stored.

## URLs

`getUrl()` returns the public object URL, which only works for public buckets. For private buckets use `getPresignedUrl()` (a Supabase signed URL) or `get()`.

## Upload status

`pathFor` and `head` are implemented, so `client.getUploadStatus()` reports `complete` or `missing`, and lost upload responses are recovered without uploading twice.

## Resources

- [Documentation](https://www.usefileway.dev/docs/drivers/supabase)
- [License: MIT](https://github.com/Goldenhub/fileway/blob/main/LICENSE)
