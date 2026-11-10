# RFC 0002: Plugins and the `@fileway/infra` plugin

- **Status:** Part 1 (plugin API, events, handler) implemented, unreleased, planned for 0.7.0. Part 2 (`@fileway/infra`) is a draft.
- **Target:** `@fileway/core` 0.7.0 (plugin API, additive, this repo); `@fileway/infra` 0.1 (private `fileway-infrastructure` repo)
- **Depends on:** [RFC 0001](./0001-list-copy-move.md) (list, stat, copy, move)

## Summary

Fileway gets two parts, modeled on Better Auth:

- **Fileway Framework**: the free, MIT-licensed `@fileway/*` packages, unchanged in spirit.
- **Fileway Infrastructure**: a paid, hosted service (dashboard, analytics, audit log, upload protection, team access) that connects to a developer's app through a plugin.

This RFC covers the open-source side of that connection: a general **plugin API** in `@fileway/core`, a web-standard **request handler** on the client, and the **`@fileway/infra` plugin** that reports events and answers dashboard requests. The hosted service itself is out of scope.

```ts
import { FilewayClient } from "@fileway/core";
import { infra } from "@fileway/infra";

export const client = new FilewayClient({
  driver,
  plugins: [infra({ apiKey: process.env.FILEWAY_API_KEY })],
});

// app/api/fileway/[...all]/route.ts
export const { GET, POST } = client.handler;
```

## Goals

1. Storage credentials never leave the developer's app. Fileway Infrastructure can only act on storage by asking the app, and the app verifies every request.
2. File bytes never pass through Fileway servers: downloads and dashboard uploads use presigned URLs created by the app.
3. Infrastructure being down, slow or misconfigured never breaks the app's uploads or downloads.
4. Zero runtime dependencies and no `node:*` imports in `@fileway/core` and `@fileway/infra`, so the plugin runs everywhere the Framework does.
5. The plugin API is general: Infrastructure is the first plugin, not a special case.

## Non-goals

- Hosting files, proxying bytes, or holding storage keys on Fileway servers.
- Replacing the app's own user authentication. Dashboard users are separate from the app's users.

## Part 1: Plugin API in `@fileway/core`

```ts
export interface FilewayPlugin {
  /** Unique, e.g. "infra". */
  id: string;
  /** Runs once when the client is created. */
  init?(ctx: PluginContext): void;
  /** Merged into the client's middleware chain, after user middlewares. */
  middlewares?: MiddlewareHook[];
  /** Called for every finished operation, success or failure. Never awaited
   * by the operation; errors are caught and logged. */
  onEvent?(event: FilewayEvent): void;
  /** Routes this plugin serves under the client's handler, e.g. "/infra/*". */
  routes?: Record<string, PluginRoute>;
}

export interface PluginContext {
  client: FilewayClient<BaseDriver>; // for list/stat/presign/delete/... from routes
  driverName: string;
  logger: Logger;
}

export type PluginRoute = (request: Request, ctx: PluginContext) => Promise<Response>;

export interface FilewayConfig<TDriver extends BaseDriver> {
  // ...existing options...
  plugins?: FilewayPlugin[];
}
```

### Events

One stable shape, emitted once per operation after retries finish:

```ts
export interface FilewayEvent {
  id: string;                // random, for de-duplication
  time: string;              // ISO 8601
  operation: "upload" | "get" | "delete" | "getUrl" | "getPresignedUrl" | "getUploadStatus" | "list" | "stat" | "copy" | "move";
  outcome: "success" | "error" | "aborted";
  path?: string;
  size?: number;
  mimeType?: string;
  durationMs: number;
  attempts: number;
  driver: string;
  error?: { name: string; message: string; code?: StorageErrorCode; statusCode?: number };
  /** Set by the app through `actor` on the call, e.g. the signed-in user's id. */
  actor?: string;
  /** Free-form tags from the call, e.g. { tenant: "acme" }. */
  tags?: Record<string, string>;
}
```

To attribute events to a user, every client method accepts `actor?: string` and `tags?: Record<string, string>` in its options (`TrackOptions`). They are not passed to drivers or middleware. (An earlier draft nested them under `context`, which clashed with the driver-side `UploadContext`.)

### Request handler

```ts
client.handler: {
  fetch(request: Request): Promise<Response>;
  // The same function under every method name, for Next.js-style route exports:
  GET; POST; PUT; PATCH; DELETE; HEAD; OPTIONS;
}
```

It serves plugin routes under `basePath` (a `FilewayConfig` option, default `"/api/fileway"`; an earlier draft guessed it from the first request, which was unpredictable). Route keys are `"METHOD /path"` or `"METHOD /path/*"`; exact routes win over wildcards. Unknown paths return 404, a known path with another method 405 with `Allow`, and a throwing route 500 with a generic body. Workers, Bun, Deno, Next.js and Hono (`c.req.raw`) use it directly; an Express adapter is left to `@fileway/infra`.

### Rules

- Plugins never change what an operation returns, and an `onEvent` or route failure never fails an operation.
- Plugin middlewares run after user middlewares, so protection sees the final stream and options.
- Two plugins with the same `id` throw `config` at construction.

## Part 2: `@fileway/infra`

```ts
infra({
  apiKey: string,                    // from the dashboard; identifies the project
  endpoint?: string,                 // default https://api.usefileway.dev
  events?: {
    enabled?: boolean,               // default true
    redact?: "none" | "hash-paths" | "omit-paths", // default "none"
    sampleRate?: number,             // 0..1, default 1 (audit needs 1)
  },
  protection?: boolean,              // default true; rules come from the dashboard
  allow?: (op: AdminOperation, path: string) => boolean | Promise<boolean>, // app-side veto
})
```

### 1. Event reporting

- `onEvent` pushes into an in-memory queue. A flush sends a batch (up to 500 events or 1 MB) with `POST {endpoint}/v1/events`, `Authorization: Bearer <apiKey>`.
- Flushes every 2 seconds or at 100 queued events. On serverless and edge runtimes, the handler and the client call `waitUntil` when the platform provides it (Workers, Vercel), so a flush survives the response.
- Delivery is at least once with exponential backoff; the service de-duplicates by event `id`. The queue is capped (default 10,000 events); when full, the oldest are dropped and a `warn` is logged.
- `redact` applies before anything leaves the app. `hash-paths` uses SHA-256 with a per-project salt from the dashboard, so paths stay groupable without being readable.

### 2. Admin routes (the dashboard's requests)

Served under `{base}/infra/*`:

| Route | Does | Uses |
|---|---|---|
| `POST /infra/list` | One page of a folder | `client.list` |
| `POST /infra/stat` | One file's details | `client.stat` |
| `POST /infra/link` | Short-lived download or preview URL | `client.getPresignedUrl`; for drivers without presigned URLs (Local, WebDAV), an app-signed link served by this handler ([RFC 0004](./0004-app-signed-links.md)) |
| `POST /infra/upload-url` | Presigned upload target for dashboard uploads | `client.getPresignedUploadUrl` ([RFC 0004](./0004-app-signed-links.md)): app-signed for every driver now, native for S3, GCS and Azure in a follow-up |
| `POST /infra/delete` | Delete one file | `client.delete` |
| `POST /infra/move`, `/infra/copy` | Rename, move, copy | `client.move`, `client.copy` |
| `GET /infra/health` | Version, driver name, capabilities | none |

Every request is authenticated by signature, not by the API key alone:

- The service signs `method`, `path`, `body SHA-256` and a `timestamp` with HMAC-SHA256 using a **signing secret** derived from the API key (the key itself is never sent to the app). Headers: `fileway-signature`, `fileway-timestamp`, `fileway-nonce`.
- The plugin rejects requests older than 60 seconds or with a nonce it has seen in that window, then checks the signature with a constant-time compare (Web Crypto `verify`).
- The request carries the dashboard user's id and role. The service enforces roles; the plugin also calls `allow(op, path)` when provided, so the app keeps a final veto (for example, never allow deletes under `invoices/`).
- Responses never include storage credentials. `link` returns URLs that expire in at most 15 minutes.
- Every admin action is also emitted as an event with `actor: "dashboard:<userId>"`, so the audit log covers both the app and the dashboard.

### 3. Upload protection

A plugin middleware (`beforeUpload`) applies rules fetched from `GET {endpoint}/v1/rules` and cached for 60 seconds:

- **Type check:** reads the first 4 KB through a pass-through `TransformStream` (no buffering of the rest) and compares the detected type (magic bytes) to `mimeType` and the extension. Mismatches are rejected or flagged, per rule.
- **Size limits** per path prefix.
- **Quotas and rate limits** per `actor`, counted by the service from events; the cached rules include current over-limit actors.
- Rejections throw `StorageError("validation")` with a clear message and are reported as events.
- **Fail open:** if rules cannot be fetched and none are cached, uploads proceed and a `warn` is logged. Enterprise can switch to fail closed.

Virus scanning is out of scope here; it needs a service-side scanner and its own RFC.

### 4. Health and connection

On `init`, the plugin calls `POST {endpoint}/v1/connect` with its version, driver name, capabilities (which optional driver methods exist) and the handler base URL if configured. The dashboard uses capabilities to hide actions the driver cannot do (for example, no copy on Cloudinary).

## Failure modes

| Situation | Behavior |
|---|---|
| Infrastructure unreachable | Uploads and downloads unaffected; events queue then drop oldest; dashboard shows "app offline" |
| Wrong or revoked API key | One `error` log at startup, events disabled, admin routes return 401 |
| App behind a private network | Events still flow out; the dashboard cannot reach admin routes. Enterprise self-hosted dashboard covers this |
| Clock skew over 60 seconds | Admin requests rejected with a clear `fileway-error: clock-skew` header |
| Handler not mounted | Dashboard shows setup instructions; events still work |

## Repositories and licensing

The code splits across two repositories, the same way Better Auth splits `better-auth` and its infrastructure:

- **Public `fileway` repo (MIT):** Part 1 of this RFC, the plugin API, events and `client.handler` in `@fileway/core`. Anyone can use it to write their own plugins.
- **Private `fileway-infrastructure` repo:** a monorepo with the `@fileway/infra` plugin (`packages/infra`), the shared protocol types, the hosted dashboard and the backend service. Plugin and service change together in one pull request.

`@fileway/infra` is still published to the public npm registry under MIT, so customers can install it without credentials and read exactly what runs in their app. It is useless without an API key; the paid part is the hosted service. To keep the published plugin easy to audit:

- ship readable, unminified JavaScript with source maps;
- point the package's `repository` and `bugs` fields at the public `fileway` repo (or the docs), since the private repo would return 404;
- publish a security page describing what the plugin sends, which routes it exposes and how requests are signed.

npm provenance may not be available for a package built from a private repository; confirm before release, and note it in the security page if it is missing.

## Testing

- Core: plugin ordering, `onEvent` isolation (a throwing plugin never fails an operation), handler routing and 404s, duplicate plugin ids.
- Infra: batching, backoff and queue cap with a mocked endpoint; redaction; signature verification (valid, expired, replayed, tampered body, wrong secret); `allow` veto; type sniffing on streams split across chunks; fail-open and fail-closed.
- Runtimes: unit tests in Node and `edge-runtime`; one end-to-end test against a local mock service in CI.

## Open questions

1. Should events carry `mimeType` and `size` by default, or only with an opt-in for privacy?
2. Is per-project pricing (one API key per app) the right unit, or per organization?
3. Dashboard uploads can ship with app-signed upload links (RFC 0004) for every driver. Native presigned uploads for S3, GCS and Azure (POST policy, signed PUT, SAS write) would keep large cloud uploads off the app's bandwidth: worth doing before launch, or after?
4. Should the plugin persist its event queue across restarts (for example to a file on Node) or accept loss on crash?
