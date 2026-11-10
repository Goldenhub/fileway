export * from "./types.js";
export * from "./errors.js";
export * from "./logging.js";
// Driver-author helpers. The client's own plumbing (retry timing, progress,
// timeouts, ID checks) stays internal.
export {
  ValidationError,
  abortError,
  validateUploadOptions,
  urlEncodePath,
  encodeCursor,
  decodeCursor,
} from "./validation.js";

// Replaced with the package.json version at build time (see tsup.config.ts).
declare const __FILEWAY_VERSION__: string | undefined;
export const version: string = typeof __FILEWAY_VERSION__ === "string" ? __FILEWAY_VERSION__ : "0.0.0-dev";

import type {
  BaseDriver,
  CopyOptions,
  LinksConfig,
  PresignedUpload,
  PresignedUploadOptions,
  EventOperation,
  FilewayEvent,
  FilewayHandler,
  FilewayPlugin,
  PluginContext,
  TrackOptions,
  DriverMeta,
  FilewayConfig,
  ListedObject,
  ListOptions,
  ListPage,
  OperationOptions,
  PresignedUrlOptions,
  RetryConfig,
  StoredObject,
  UploadOptions,
  UploadResult,
  UploadStatus,
  UploadStatusOptions,
} from "./types.js";
import { withProgress } from "./progress.js";
import { StorageError, isAbortError } from "./errors.js";
import {
  ValidationError,
  abortError,
  validateObjectPath,
  validatePrefix,
  validateUploadId,
  validateUploadOptions,
} from "./validation.js";
import { delayWithJitter, isRetryable, sleep } from "./retry.js";
import { IdleTimer, linkSignals, raceAbort, timeoutError, withActivity, withTimeLimit } from "./timeout.js";
import { buildRoutes, createHandler } from "./plugins.js";
import {
  DEFAULT_MAX_EXPIRES_IN,
  checkExpiresIn,
  checkSecrets,
  deriveKeys,
  isSafeInline,
  linkRoutes,
  mimeFromPath,
  signDownload,
  signUpload,
} from "./links.js";
import type { ErrorContext, Logger, LogLevel, Operation } from "./logging.js";

/** The driver's own options type for a `(path, options?)` method, or
 * `unknown` when it takes none, so driver-specific options (e.g. Cloudinary's
 * `deliveryType`) pass through the client. */
type MethodOptions<F> = F extends (path: string, options?: infer O) => unknown ? NonNullable<O> : unknown;
/** Same as `MethodOptions`, for `(from, to, options?)` methods. */
type CopyMethodOptions<F> = F extends (from: string, to: string, options?: infer O) => unknown ? NonNullable<O> : unknown;

export class FilewayClient<TDriver extends BaseDriver> {
  private driver: TDriver;
  private middlewares: NonNullable<FilewayConfig<TDriver>["middlewares"]>;
  private logger: Logger | undefined;
  private onError: ((error: unknown, context: ErrorContext) => void | Promise<void>) | undefined;
  private retry: RetryConfig;
  private plugins: FilewayPlugin[];
  private basePath: string;
  private links: LinksConfig | undefined;
  private linkKeys: (() => Promise<CryptoKey[]>) | undefined;
  /**
   * Serves plugin routes under `basePath` (default `/api/fileway`). Mount it as
   * a web-standard handler: `export const { GET, POST } = client.handler` in a
   * Next.js route, or `fetch: client.handler.fetch` on Workers, Bun and Deno.
   */
  readonly handler: FilewayHandler;

  constructor(config: FilewayConfig<TDriver>) {
    this.driver = config.driver;
    this.logger = config.logger;
    this.onError = config.onError;
    this.retry = config.retry ?? {};
    const idle = this.retry.idleTimeoutMs;
    if (idle !== undefined && !(Number.isFinite(idle) && idle > 0)) {
      throw new StorageError("config", "retry.idleTimeoutMs must be a positive number of milliseconds");
    }

    this.plugins = config.plugins ?? [];
    this.basePath = (config.basePath ?? "/api/fileway").replace(/\/+$/, "");
    this.links = config.links;
    let builtins = {};
    if (config.links) {
      const secrets = checkSecrets(config.links.secret);
      try {
        new URL(config.links.origin);
      } catch {
        throw new StorageError("config", "links.origin must be an absolute URL, e.g. https://files.example.com");
      }
      let keys: Promise<CryptoKey[]> | undefined;
      this.linkKeys = () => (keys ??= deriveKeys(secrets));
      builtins = linkRoutes({
        driver: this.driver,
        config: config.links,
        keys: this.linkKeys,
        get: (path, options) => this.get(path, options as never),
        upload: (stream, options) => this.upload(stream, options as never),
      });
    }
    const routes = buildRoutes(this.plugins, builtins);
    // Plugin middleware runs after the app's own, so it sees the final stream and options.
    const pluginMiddlewares = this.plugins.flatMap((plugin) => plugin.middlewares ?? []);
    this.middlewares = [
      ...(config.middlewares ?? []),
      ...(pluginMiddlewares as NonNullable<FilewayConfig<TDriver>["middlewares"]>),
    ];
    const ctx: PluginContext = {
      client: this as unknown as FilewayClient<BaseDriver>,
      driverName: this.driver.name,
      log: {
        debug: (message, meta) => this.emit("debug", message, meta),
        info: (message, meta) => this.emit("info", message, meta),
        warn: (message, meta) => this.emit("warn", message, meta),
        error: (message, meta) => this.emit("error", message, meta),
      },
    };
    this.handler = createHandler(routes, this.basePath, ctx, ctx.log);
    for (const plugin of this.plugins) plugin.init?.(ctx);
  }

  async upload(
    stream: ReadableStream<Uint8Array>,
    // Accept the driver's own upload options (e.g. Cloudinary's
    // `deliveryType`) on top of the core ones.
    options: UploadOptions & Parameters<TDriver["upload"]>[1] & TrackOptions,
  ): Promise<Awaited<ReturnType<TDriver["upload"]>>> {
    const started = Date.now();
    const track = trackOf(options);
    const maxRetries = this.retry.maxRetries ?? 3;
    const canRetry = options.streamFactory !== undefined && maxRetries > 0;
    const idleMs = this.retry.idleTimeoutMs;

    // One ID and token for the whole call, shared by every retry: a retry then
    // targets the same object, and a lost response can be recovered by asking
    // the driver whether that object already landed.
    if (options.id !== undefined) {
      try {
        validateUploadId(options.id);
      } catch (error) {
        await this.reportFailure(error, { operation: "upload", durationMs: 0, filename: options.filename }, { attempts: 0, ...track });
        throw error;
      }
    }
    const id = options.id ?? globalThis.crypto.randomUUID();
    const uploadToken = globalThis.crypto.randomUUID();
    // Attribution is for events only; drivers and middleware never see it.
    const base = { ...stripTrack(options), id };

    let attempt = 1;
    let activeOptions: typeof options = { ...base };

    this.emit("info", "upload started", {
      operation: "upload",
      id,
      ...(options.filename !== undefined ? { filename: options.filename } : {}),
      ...(options.path !== undefined ? { path: options.path } : {}),
      ...(options.mimeType !== undefined ? { mimeType: options.mimeType } : {}),
      ...(options.size !== undefined ? { size: options.size } : {}),
    });

    for (;;) {
      // Every attempt starts from the caller's original options, so
      // `beforeUpload` middleware never transforms its own earlier output.
      let activeStream = attempt === 1 ? stream : options.streamFactory!();
      activeOptions = { ...base };
      let reachedDriver = false;
      // With `idleTimeoutMs`, each attempt gets its own cancel signal, linked to
      // the caller's, and a timer that fires when the attempt stops progressing.
      let idle: IdleTimer | undefined;
      let linked: { signal: AbortSignal; dispose: () => void } | undefined;
      const endAttempt = () => {
        idle?.stop();
        linked?.dispose();
      };

      try {
        for (const middleware of this.middlewares) {
          if (middleware.beforeUpload) {
            const result = await middleware.beforeUpload(activeStream, activeOptions);
            if (!result) continue;
            const sizeBefore = activeOptions.size;
            if (result.options) activeOptions = result.options;
            if (result.stream) {
              activeStream = result.stream;
              // The new stream may not be the old length. Keep a size only if
              // this middleware vouched for it; a spread `...options` carries
              // the old size along by accident and does not count.
              const size =
                result.size ?? (activeOptions.size !== sizeBefore ? activeOptions.size : undefined);
              activeOptions = withSize(activeOptions, size);
            }
          }
        }
        // Middleware may rebuild options from scratch; the identity must survive.
        activeOptions = { ...activeOptions, id };

        let attemptSignal: AbortSignal | undefined;
        if (idleMs !== undefined) {
          const attemptAbort = new AbortController();
          const timer = new IdleTimer(idleMs, () => attemptAbort.abort(abortError("upload attempt timed out")));
          idle = timer;
          linked = linkSignals(options.signal, attemptAbort.signal);
          attemptSignal = linked.signal;
          activeStream = withActivity(activeStream, () => timer.touch());
          activeOptions = { ...activeOptions, signal: attemptSignal };
          timer.touch();
        }

        const progressStream = activeOptions.onProgress
          ? withProgress(activeStream, activeOptions.onProgress, activeOptions.size)
          : activeStream;

        reachedDriver = true;
        const pending = this.driver.upload(progressStream, activeOptions, { uploadToken });
        // Don't wait on a driver that ignores its signal once the attempt is cancelled.
        const uploadResult = await (attemptSignal ? raceAbort(pending, attemptSignal) : pending);
        endAttempt();
        return (await this.finishUpload(uploadResult, activeOptions, started, attempt, track)) as Awaited<ReturnType<TDriver["upload"]>>;
      } catch (caught) {
        endAttempt();
        // An attempt we cancelled for inactivity is a retryable timeout;
        // the caller's own abort stays final.
        const error =
          idle?.fired && !options.signal?.aborted ? timeoutError("upload", idleMs!, caught) : caught;

        // The provider may have stored the object even though the response was
        // lost. If it did, return it instead of re-sending (or failing).
        if (reachedDriver && isRetryable(error, this.retry)) {
          const recovered = await this.recoverLostResponse({ ...activeOptions, id }, uploadToken, options.signal);
          if (recovered) {
            this.emit("info", "upload recovered after lost response", { operation: "upload", id, attempt });
            return (await this.finishUpload(recovered, activeOptions, started, attempt, track)) as Awaited<ReturnType<TDriver["upload"]>>;
          }
        }

        const delay = delayWithJitter(attempt, this.retry);
        const canRetryNow = canRetry && isRetryable(error, this.retry) && attempt <= maxRetries;
        if (!canRetryNow) {
          await this.reportFailure(error, {
            operation: "upload",
            durationMs: Date.now() - started,
            ...(activeOptions.filename !== undefined ? { filename: activeOptions.filename } : {}),
            ...(activeOptions.path !== undefined ? { path: activeOptions.path } : {}),
            ...(activeOptions.mimeType !== undefined ? { mimeType: activeOptions.mimeType } : {}),
            ...(activeOptions.size !== undefined ? { size: activeOptions.size } : {}),
          }, { attempts: attempt, ...track });
          throw error;
        }

        this.emit("warn", "upload failed, retrying", {
          operation: "retry",
          attempt,
          maxRetries,
          delayMs: delay,
          error: error instanceof Error ? { name: error.name, message: error.message } : {},
        });

        try {
          await sleep(delay, options.signal);
        } catch (abort) {
          await this.reportFailure(abort, { operation: "upload", durationMs: Date.now() - started }, { attempts: attempt, ...track });
          throw abort;
        }
        attempt += 1;
      }
    }
  }

  /**
   * Reports whether the upload with `id` is stored, still in progress, or
   * missing. Pass the same `filename` and `path` the upload used. Works across
   * processes: a job that crashed mid-upload can check before redoing it.
   */
  async getUploadStatus(
    id: string,
    options: UploadStatusOptions & TrackOptions,
  ): Promise<UploadStatus<DriverMeta<TDriver>>> {
    const { signal, actor: _actor, tags: _tags, ...uploadOptions } = options;
    validateUploadOptions({ ...uploadOptions, id });
    const { pathFor, head, isPending } = this.driver;
    if (!pathFor || !head) return { state: "unsupported" };

    const path = pathFor.call(this.driver, { ...uploadOptions, id });
    return this.runWithRetry(
      "getUploadStatus",
      path,
      async (attemptSignal): Promise<UploadStatus<DriverMeta<TDriver>>> => {
        const opts = attemptSignal ? { signal: attemptSignal } : undefined;
        const object = await head.call(this.driver, path, opts);
        if (object) return { state: "complete", object: object as StoredObject<DriverMeta<TDriver>> };
        if (isPending && (await isPending.call(this.driver, path, opts))) return { state: "pending" };
        return { state: "missing" };
      },
      signal,
      trackOf(options),
    );
  }

  /** Runs `afterUpload` middleware and logs success for a stored upload. */
  private async finishUpload(
    result: UploadResult<Record<string, unknown>>,
    options: UploadOptions,
    started: number,
    attempts: number,
    track: TrackOptions,
  ): Promise<UploadResult<Record<string, unknown>>> {
    for (const middleware of this.middlewares) {
      if (middleware.afterUpload) {
        await middleware.afterUpload(result as UploadResult<DriverMeta<TDriver>>, options);
      }
    }
    this.emit("info", "upload succeeded", {
      operation: "upload",
      id: result.id,
      url: result.url,
      path: result.path,
      size: result.size,
      durationMs: Date.now() - started,
    });
    this.publish({
      operation: "upload",
      outcome: "success",
      path: result.path,
      size: result.size,
      ...(options.mimeType !== undefined ? { mimeType: options.mimeType } : {}),
      durationMs: Date.now() - started,
      attempts,
      ...track,
    });
    return result;
  }

  /**
   * After a retryable failure, asks the driver whether this call's object was
   * stored anyway. Accepts it only if it carries this call's `uploadToken`
   * (when the driver keeps tokens) and the expected size (when known).
   * Best-effort: any failure here returns `undefined` so the original error wins.
   */
  private async recoverLostResponse(
    options: UploadOptions & { id: string },
    uploadToken: string,
    signal: AbortSignal | undefined,
  ): Promise<UploadResult<Record<string, unknown>> | undefined> {
    const { pathFor, head } = this.driver;
    if (!pathFor || !head) return undefined;
    try {
      const object = await head.call(this.driver, pathFor.call(this.driver, options), signal ? { signal } : undefined);
      if (!object) return undefined;
      if (object.uploadToken !== undefined && object.uploadToken !== uploadToken) return undefined;
      if (options.size !== undefined && object.size !== options.size) return undefined;
      const { uploadToken: _token, lastModified: _modified, contentType: _type, ...result } = object;
      return result;
    } catch {
      return undefined;
    }
  }

  /** Deletes the object at `path`. Deleting a missing object is not an error. */
  async delete(path: string, options?: OperationOptions & MethodOptions<TDriver["delete"]> & TrackOptions): Promise<void> {
    return this.runWithRetry(
      "delete",
      path,
      (signal) => this.driver.delete(path, withSignal(options, signal)),
      options?.signal,
      trackOf(options),
    );
  }

  async getUrl(path: string, options?: OperationOptions & MethodOptions<TDriver["getUrl"]> & TrackOptions): Promise<string> {
    return this.runWithRetry(
      "getUrl",
      path,
      (signal) => this.driver.getUrl(path, withSignal(options, signal)),
      options?.signal,
      trackOf(options),
    );
  }

  /** Streams the object back. `options.signal` also cancels reading the body. */
  async get(
    path: string,
    options?: OperationOptions & MethodOptions<TDriver["get"]> & TrackOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    return this.runWithRetry(
      "get",
      path,
      (signal) => this.driver.get(path, withSignal(options, signal)),
      options?.signal,
      trackOf(options),
    );
  }

  async getPresignedUrl(
    path: string,
    options?: PresignedUrlOptions & MethodOptions<NonNullable<TDriver["getPresignedUrl"]>> & TrackOptions,
  ): Promise<string> {
    const native = this.driver.getPresignedUrl;
    const appSigned = this.links !== undefined && (this.links.mode === "always" || !native);
    return this.runWithRetry("getPresignedUrl", path, async (signal) => {
      if (appSigned) return this.signDownloadLink(path, options);
      if (!native) {
        throw new StorageError(
          "config",
          `driver ${this.driver.name} does not support presigned URLs; configure links to use app-signed links`,
          { provider: this.driver.name },
        );
      }
      return native.call(this.driver, path, withSignal(options, signal));
    }, options?.signal, trackOf(options));
  }

  /**
   * A signed link a browser can upload one file to with `PUT`, served by
   * `client.handler`. The link fixes the filename, folder, id, content type
   * and size limit. Needs `links` in the client config.
   */
  async getPresignedUploadUrl(options: PresignedUploadOptions & TrackOptions): Promise<PresignedUpload> {
    const links = this.links;
    if (!links || !this.linkKeys) {
      throw new StorageError("config", "getPresignedUploadUrl needs links in the client config");
    }
    validateUploadOptions(options);
    const id = options.id ?? globalThis.crypto.randomUUID();
    validateUploadId(id);
    const maxSize = options.maxSize ?? this.driver.capabilities?.maxUploadBytes;
    if (maxSize === undefined) {
      throw new ValidationError("maxSize is required: the driver has no upload size limit of its own");
    }
    if (!Number.isInteger(maxSize) || maxSize < 1) throw new ValidationError("maxSize must be a positive integer");
    const expiresIn = options.expiresIn ?? 900;
    checkExpiresIn(expiresIn, links.maxExpiresIn ?? DEFAULT_MAX_EXPIRES_IN);
    return this.runWithRetry("getPresignedUrl", options.path ?? "", async () => {
      const [key] = await this.linkKeys!();
      const url = await signUpload({
        key: key!,
        base: this.linkBase(links),
        filename: options.filename,
        id,
        maxSize,
        expires: Math.floor(Date.now() / 1000) + expiresIn,
        ...(options.path ? { path: options.path } : {}),
        ...(options.mimeType ? { mimeType: options.mimeType } : {}),
      });
      return { url, method: "PUT" as const, headers: options.mimeType ? { "content-type": options.mimeType } : {}, id };
    }, options.signal, trackOf(options));
  }

  private linkBase(links: LinksConfig): string {
    return `${links.origin.replace(/\/+$/, "")}${this.basePath}`;
  }

  private async signDownloadLink(path: string, options?: PresignedUrlOptions): Promise<string> {
    const links = this.links!;
    validateObjectPath(path);
    const expiresIn = options?.expiresIn ?? 3600;
    checkExpiresIn(expiresIn, links.maxExpiresIn ?? DEFAULT_MAX_EXPIRES_IN);
    if (options?.id !== undefined) validateUploadId(options.id);
    const type = mimeFromPath(path) ?? "application/octet-stream";
    const safe = isSafeInline(type, links.inlineTypes);
    const disposition = options?.disposition ?? (safe ? "inline" : "attachment");
    if (disposition === "inline" && !safe) {
      throw new ValidationError(`${type} files cannot open inline; add the type to links.inlineTypes to allow it`);
    }
    const [key] = await this.linkKeys!();
    return signDownload({
      key: key!,
      base: this.linkBase(links),
      path,
      expires: Math.floor(Date.now() / 1000) + expiresIn,
      disposition,
      ...(options?.filename ? { filename: options.filename } : {}),
      ...(options?.id ? { id: options.id } : {}),
    });
  }

  /** One page of the objects under `options.prefix`. Pass `page.cursor` back to get the next one. */
  async list(options?: ListOptions & TrackOptions): Promise<ListPage> {
    const prefix = options?.prefix ?? "";
    validatePrefix(prefix);
    const limit = options?.limit;
    if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= 1000)) {
      throw new ValidationError("limit must be an integer from 1 to 1000");
    }
    return this.runWithRetry("list", prefix, (signal) => {
      const list = this.driver.list;
      if (!list) throw this.unsupported("listing");
      return list.call(this.driver, withSignal(options, signal));
    }, options?.signal, trackOf(options));
  }

  /**
   * Every object under `options.prefix`, following cursors page by page.
   * One folder level unless `recursive` is true; folders themselves are not
   * yielded. Stops when the loop breaks or `options.signal` aborts.
   */
  async *listAll(options?: Omit<ListOptions, "cursor"> & TrackOptions): AsyncGenerator<ListedObject, void, undefined> {
    let cursor: string | undefined;
    do {
      const page = await this.list({ ...options, ...(cursor !== undefined ? { cursor } : {}) });
      yield* page.objects;
      cursor = page.cursor;
    } while (cursor !== undefined);
  }

  /** The stored object at `path`, or `null` when there is none. */
  async stat(
    path: string,
    options?: OperationOptions & MethodOptions<NonNullable<TDriver["head"]>> & TrackOptions,
  ): Promise<StoredObject<DriverMeta<TDriver>> | null> {
    validateObjectPath(path);
    return this.runWithRetry("stat", path, async (signal) => {
      const head = this.driver.head;
      if (!head) throw this.unsupported("stat");
      return (await head.call(this.driver, path, withSignal(options, signal))) as StoredObject<DriverMeta<TDriver>> | null;
    }, options?.signal, trackOf(options));
  }

  /**
   * Copies `from` to `to` on the same storage. An existing `to` fails with a
   * `conflict` error unless `options.overwrite` is true.
   */
  async copy(
    from: string,
    to: string,
    options?: CopyOptions & CopyMethodOptions<NonNullable<TDriver["copy"]>> & TrackOptions,
  ): Promise<void> {
    this.validatePair(from, to);
    let attempt = 0;
    await this.runWithRetry("copy", from, async (signal) => {
      const copy = this.driver.copy;
      if (!copy) throw this.unsupported("copy");
      attempt++;
      try {
        await copy.call(this.driver, from, to, withSignal(options, signal));
      } catch (error) {
        // A retry after a lost response finds the copy it already made.
        if (attempt > 1 && isCode(error, "conflict") && (await this.sameObject(from, to, signal))) return;
        throw error;
      }
    }, options?.signal, trackOf(options));
  }

  /**
   * Moves (renames) `from` to `to`. Drivers without a native move get a copy
   * followed by a delete, which is not atomic: if the delete fails, both
   * paths exist and the error is thrown.
   */
  async move(
    from: string,
    to: string,
    options?: CopyOptions & CopyMethodOptions<NonNullable<TDriver["move"]>> & TrackOptions,
  ): Promise<void> {
    this.validatePair(from, to);
    const move = this.driver.move;
    if (!move) {
      if (!this.driver.copy) {
        const error = this.unsupported("move");
        await this.reportFailure(error, { operation: "move", durationMs: 0, path: from }, { attempts: 0, ...trackOf(options) });
        throw error;
      }
      await this.copy(from, to, options as CopyOptions & CopyMethodOptions<NonNullable<TDriver["copy"]>> & TrackOptions);
      // The fallback reports its own copy and delete events, not a move event.
      const deleteOptions = { ...(options?.signal ? { signal: options.signal } : {}), ...trackOf(options) };
      await this.delete(from, (Object.keys(deleteOptions).length > 0 ? deleteOptions : undefined) as Parameters<this["delete"]>[1]);
      return;
    }
    let attempt = 0;
    await this.runWithRetry("move", from, async (signal) => {
      attempt++;
      try {
        await move.call(this.driver, from, to, withSignal(options, signal));
      } catch (error) {
        // A retry after a lost response finds the source already gone.
        if (attempt > 1 && isCode(error, "not-found") && (await this.exists(to, signal))) return;
        throw error;
      }
    }, options?.signal, trackOf(options));
  }

  private validatePair(from: string, to: string): void {
    validateObjectPath(from, "from");
    validateObjectPath(to, "to");
    if (from === to) throw new ValidationError("from and to must be different paths");
  }

  private unsupported(what: string): StorageError {
    return new StorageError("config", `driver ${this.driver.name} does not support ${what}`, {
      provider: this.driver.name,
    });
  }

  /** Whether `path` exists, best effort (false when the driver cannot tell). */
  private async exists(path: string, signal: AbortSignal | undefined): Promise<boolean> {
    const head = this.driver.head;
    if (!head) return false;
    try {
      return (await head.call(this.driver, path, signal ? { signal } : undefined)) !== null;
    } catch {
      return false;
    }
  }

  /** Whether `to` looks like a copy of `from`: same size, and same ETag when both have one. */
  private async sameObject(from: string, to: string, signal: AbortSignal | undefined): Promise<boolean> {
    const head = this.driver.head;
    if (!head) return false;
    try {
      const opts = signal ? { signal } : undefined;
      const [a, b] = await Promise.all([head.call(this.driver, from, opts), head.call(this.driver, to, opts)]);
      if (!a || !b || a.size !== b.size) return false;
      const etagA = (a.meta as { etag?: unknown }).etag;
      const etagB = (b.meta as { etag?: unknown }).etag;
      return etagA === undefined || etagB === undefined || etagA === etagB;
    } catch {
      return false;
    }
  }

  /**
   * Runs `fn` with retries. Each attempt receives the signal to hand to the
   * driver: the caller's, linked with a per-attempt one when `idleTimeoutMs`
   * is set, so a timed-out attempt's request is actually cancelled.
   */
  private async runWithRetry<T>(
    operation: "delete" | "getUrl" | "get" | "getPresignedUrl" | "getUploadStatus" | "list" | "stat" | "copy" | "move",
    path: string,
    fn: (signal: AbortSignal | undefined) => Promise<T>,
    signal: AbortSignal | undefined,
    track: TrackOptions,
  ): Promise<T> {
    const started = Date.now();
    const maxRetries = this.retry.maxRetries ?? 3;

    this.emit("info", `${operation} started`, { operation, path });

    let attempt = 1;
    for (;;) {
      try {
        if (signal?.aborted) throw abortError(`${operation} aborted`);
        const idleMs = this.retry.idleTimeoutMs;
        let result: T;
        if (idleMs === undefined) {
          result = await fn(signal);
        } else {
          const attemptAbort = new AbortController();
          // Not disposed on success: a stream returned by `get` keeps honoring
          // the caller's signal while its body is read.
          const linked = linkSignals(signal, attemptAbort.signal);
          try {
            result = await withTimeLimit(fn(linked.signal), idleMs, operation, () =>
              attemptAbort.abort(abortError(`${operation} attempt timed out`)),
            );
          } catch (error) {
            linked.dispose();
            throw error;
          }
        }
        this.emit("info", `${operation} succeeded`, { operation, path, durationMs: Date.now() - started });
        this.publish({ operation, outcome: "success", path, durationMs: Date.now() - started, attempts: attempt, ...track });
        return result;
      } catch (error) {
        const delay = delayWithJitter(attempt, this.retry);
        const canRetryNow = isRetryable(error, this.retry) && attempt <= maxRetries;
        if (!canRetryNow) {
          await this.reportFailure(error, { operation, durationMs: Date.now() - started, path }, { attempts: attempt, ...track });
          throw error;
        }

        this.emit("warn", `${operation} failed, retrying`, {
          operation: "retry",
          attempt,
          maxRetries,
          delayMs: delay,
          error: error instanceof Error ? { name: error.name, message: error.message } : {},
        });

        try {
          await sleep(delay, signal);
        } catch (abort) {
          await this.reportFailure(abort, { operation, durationMs: Date.now() - started, path }, { attempts: attempt, ...track });
          throw abort;
        }
        attempt += 1;
      }
    }
  }

  private emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const log = this.logger?.[level];
    if (!log) return;
    try {
      log.call(this.logger, message, meta);
    } catch (err) {
      // A user logger must never break the operation it is reporting on.
      console.error(`[fileway] logger.${level} threw`, err);
    }
  }

  private async notifyError(error: unknown, context: ErrorContext): Promise<void> {
    if (!this.onError) return;
    try {
      await this.onError(error, context);
    } catch {
      // A failing onError hook must never mask the original error.
    }
  }

  private async reportFailure(
    error: unknown,
    context: ErrorContext,
    event: TrackOptions & { attempts: number },
  ): Promise<void> {
    this.emit("error", `${context.operation} failed`, {
      ...context,
      ...(error instanceof Error ? { error: { name: error.name, message: error.message } } : {}),
    });
    const aborted = isAbortError(error);
    this.publish({
      operation: context.operation as EventOperation,
      outcome: aborted ? "aborted" : "error",
      ...(context.path !== undefined ? { path: context.path } : {}),
      ...(context.size !== undefined ? { size: context.size } : {}),
      ...(context.mimeType !== undefined ? { mimeType: context.mimeType } : {}),
      durationMs: context.durationMs,
      ...(aborted ? {} : { error: errorInfo(error) }),
      ...event,
    });
    if (!aborted) {
      await this.notifyError(error, context);
    }
  }

  /** Delivers an event to every plugin's `onEvent`, without waiting or failing. */
  private publish(event: Omit<FilewayEvent, "id" | "time" | "driver">): void {
    const listeners = this.plugins.filter((plugin) => plugin.onEvent);
    if (listeners.length === 0) return;
    const full: FilewayEvent = {
      id: globalThis.crypto.randomUUID(),
      time: new Date().toISOString(),
      driver: this.driver.name,
      ...event,
    };
    for (const plugin of listeners) {
      const fail = (err: unknown) =>
        this.emit("warn", "plugin onEvent failed", {
          plugin: plugin.id,
          error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
        });
      try {
        const result = plugin.onEvent!(full);
        if (result && typeof (result as Promise<void>).then === "function") (result as Promise<void>).catch(fail);
      } catch (err) {
        fail(err);
      }
    }
  }
}

/** The `actor` and `tags` of an options object, without anything else. */
function trackOf(options: TrackOptions | undefined): TrackOptions {
  return {
    ...(options?.actor !== undefined ? { actor: options.actor } : {}),
    ...(options?.tags !== undefined ? { tags: options.tags } : {}),
  };
}

/** `options` without `actor` and `tags`, which are for events, not drivers. */
function stripTrack<T extends object>(options: T): T {
  const { actor: _actor, tags: _tags, ...rest } = options as T & TrackOptions;
  return rest as T;
}

function errorInfo(error: unknown): NonNullable<FilewayEvent["error"]> {
  if (error instanceof StorageError) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      ...(error.statusCode !== undefined ? { statusCode: error.statusCode } : {}),
    };
  }
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}

function isCode(error: unknown, code: StorageError["code"]): boolean {
  return error instanceof StorageError && error.code === code;
}

/** `options` with `signal` replaced by the attempt's signal (or removed). */
function withSignal<T extends OperationOptions>(options: T | undefined, signal: AbortSignal | undefined): T | undefined {
  if (!options && !signal) return undefined;
  const { signal: _caller, ...rest } = stripTrack((options ?? {}) as T);
  const result = signal ? { ...rest, signal } : rest;
  return Object.keys(result).length > 0 ? (result as T) : undefined;
}

/** Returns a copy of `options` with `size` set, or removed when undefined. */
function withSize<T extends UploadOptions>(options: T, size: number | undefined): T {
  const { size: _stale, ...rest } = options;
  return (size === undefined ? rest : { ...rest, size }) as T;
}
