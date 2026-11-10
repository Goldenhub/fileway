import type { BaseDriver, DriverCapabilities, GetOptions, CopyOptions, ListedObject, ListOptions, ListPage, OperationOptions, StoredObject, UploadOptions, UploadResult } from "@fileway/core";
import { validateUploadOptions, ValidationError, urlEncodePath, abortError, StorageError, encodeCursor, decodeCursor } from "@fileway/core";
import { createWriteStream, createReadStream, constants } from "node:fs";
import { mkdir, unlink, access, lstat, rename, stat, readdir, copyFile } from "node:fs/promises";
import { join, dirname, basename, resolve, relative, isAbsolute } from "node:path";
import { Readable } from "node:stream";

const randomUUID = () => globalThis.crypto.randomUUID();
// Suffix of in-progress upload files; see `upload` and `isPending`.
const PARTIAL_SUFFIX = ".partial";

export interface LocalDriverConfig {
  directory: string;
  baseUrl?: string;
  maxSizeBytes?: number;
}

export type LocalMeta = {
  /** Absolute path of the stored file on disk. */
  localPath: string;
};

export class LocalDriver implements BaseDriver<LocalMeta> {
  readonly name = "local";
  private directory: string;
  private resolvedDir: string;
  private baseUrl: string;
  private maxSizeBytes: number | undefined;

  constructor(config: LocalDriverConfig) {
    this.directory = config.directory;
    this.resolvedDir = resolve(config.directory);
    this.baseUrl = config.baseUrl ?? `file://${config.directory}`;
    this.maxSizeBytes = config.maxSizeBytes;
  }

  private resolveInside(userPath: string): string {
    const full = resolve(this.directory, userPath);
    const rel = relative(this.resolvedDir, full);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new ValidationError("path escapes the configured storage directory");
    }
    return full;
  }

  private async assertSafePath(fullPath: string): Promise<void> {
    const rel = relative(this.resolvedDir, fullPath);
    if (!rel) return;
    const parts = rel.split(/[\\/]/).filter(Boolean);
    let current = this.resolvedDir;
    for (const part of parts) {
      current = join(current, part);
      const st = await lstat(current).catch(() => null);
      if (st?.isSymbolicLink()) {
        throw new ValidationError("path traverses a symbolic link");
      }
    }
  }

  async upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
  ): Promise<UploadResult<LocalMeta>> {
    validateUploadOptions(options);

    const id = options.id ?? randomUUID();
    const relativePath = this.pathFor({ ...options, id });
    const fullPath = this.resolveInside(relativePath);

    await mkdir(dirname(fullPath), { recursive: true });
    await this.assertSafePath(fullPath);

    // Write to a temporary sibling and rename it into place when complete. A
    // retry that fails partway then never truncates or deletes a copy an
    // earlier attempt already finished, and readers never see a partial file.
    const tempPath = `${fullPath}.${randomUUID()}${PARTIAL_SUFFIX}`;
    const nodeStream = Readable.fromWeb(stream as any);
    const writeStream = createWriteStream(tempPath);

    const size = await new Promise<number>((resolve, reject) => {
      let bytes = 0;
      let finished = false;

      const cleanup = (err: unknown) => {
        nodeStream.destroy();
        writeStream.destroy();
        if (finished) {
          reject(err);
        } else {
          // Wait for the partial file to be removed so callers observing the
          // rejection can rely on the directory being clean.
          unlink(tempPath)
            .catch(() => {})
            .finally(() => reject(err));
        }
      };

      const onAbort = () => cleanup(abortError("upload aborted"));
      if (options.signal) {
        if (options.signal.aborted) {
          cleanup(abortError("upload aborted"));
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      nodeStream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (this.maxSizeBytes !== undefined && bytes > this.maxSizeBytes) {
          cleanup(new StorageError("size-exceeded", `upload exceeds maxSizeBytes of ${this.maxSizeBytes}`, { provider: "local" }));
        }
      });
      nodeStream.pipe(writeStream);
      writeStream.on("finish", () => {
        rename(tempPath, fullPath).then(() => {
          finished = true;
          options.signal?.removeEventListener("abort", onAbort);
          resolve(bytes);
        }, cleanup);
      });
      writeStream.on("error", cleanup);
      nodeStream.on("error", cleanup);
    });

    const safePath = urlEncodePath(relativePath);

    return {
      id,
      url: `${this.baseUrl}/${safePath}`,
      path: relativePath,
      size,
      meta: { localPath: fullPath },
    };
  }

  /** The relative path an upload with `options.id` is stored at: `<path>/<id>.<ext>`. */
  pathFor(options: UploadOptions & { id: string }): string {
    const ext = options.filename.includes(".") ? options.filename.split(".").pop()! : "";
    const filename = ext ? `${options.id}.${ext}` : options.id;
    return options.path ? join(options.path, filename) : filename;
  }

  /**
   * The stored file at `path`, or `null` if there is none. Local disk keeps no
   * upload token, so `FilewayClient` verifies a recovered upload by size.
   */
  async head(path: string, options?: OperationOptions): Promise<StoredObject<LocalMeta> | null> {
    throwIfAborted(options?.signal);
    const fullPath = this.resolveInside(path);
    await this.assertSafePath(fullPath);
    const info = await stat(fullPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw new StorageError("provider-error", `failed to stat ${path}: ${err.message}`, { provider: "local", cause: err });
    });
    if (!info?.isFile()) return null;
    const name = basename(path);
    return {
      id: name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name,
      url: `${this.baseUrl}/${urlEncodePath(path)}`,
      path,
      size: info.size,
      meta: { localPath: fullPath },
      lastModified: info.mtime,
    };
  }

  /** Whether an upload to `path` is still being written (a `.partial` file exists). */
  async isPending(path: string, options?: OperationOptions): Promise<boolean> {
    throwIfAborted(options?.signal);
    const fullPath = this.resolveInside(path);
    const prefix = `${basename(fullPath)}.`;
    const entries = await readdir(dirname(fullPath)).catch(() => [] as string[]);
    return entries.some((entry) => entry.startsWith(prefix) && entry.endsWith(PARTIAL_SUFFIX));
  }

  /**
   * Deletes the file; a missing file is not an error. Throws a
   * `ValidationError` for paths outside the storage directory and a
   * `StorageError` for any other filesystem failure.
   */
  async delete(path: string, options?: OperationOptions): Promise<void> {
    throwIfAborted(options?.signal);
    const fullPath = this.resolveInside(path);
    await this.assertSafePath(fullPath);
    try {
      await unlink(fullPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new StorageError("provider-error", `failed to delete ${path}: ${(err as Error).message}`, {
        provider: "local",
        cause: err,
      });
    }
  }

  async getUrl(path: string): Promise<string> {
    return `${this.baseUrl}/${urlEncodePath(path)}`;
  }

  /** Streams the file. `options.signal` also stops reading it mid-stream. */
  /** Range reads, and the upload size limit used by upload links. */
  get capabilities(): DriverCapabilities {
    return { range: true, ...(this.maxSizeBytes !== undefined ? { maxUploadBytes: this.maxSizeBytes } : {}) };
  }

  async get(path: string, options?: GetOptions): Promise<ReadableStream<Uint8Array>> {
    throwIfAborted(options?.signal);
    const fullPath = this.resolveInside(path);
    await this.assertSafePath(fullPath);

    try {
      await access(fullPath);
    } catch {
      throw new StorageError("not-found", `file not found: ${path}`, { provider: "local" });
    }

    const file = createReadStream(fullPath, {
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.range ? { start: options.range.start, ...(options.range.end !== undefined ? { end: options.range.end } : {}) } : {}),
    });
    return Readable.toWeb(file) as ReadableStream<Uint8Array>;
  }

  /**
   * One page of the files under `options.prefix`, sorted by path. In-progress
   * `.partial` files and symbolic links are skipped.
   */
  async list(options?: ListOptions): Promise<ListPage> {
    throwIfAborted(options?.signal);
    const prefix = options?.prefix ?? "";
    const limit = options?.limit ?? 100;
    const after = options?.cursor !== undefined ? decodeCursor<string>(options.cursor) : undefined;
    // "photos/2026" lists entries of "photos/" whose names start with "2026".
    const cut = prefix.lastIndexOf("/") + 1;
    const dirPart = prefix.slice(0, cut);
    const namePart = prefix.slice(cut);
    const dir = dirPart ? this.resolveInside(dirPart) : this.resolvedDir;
    await this.assertSafePath(dir);

    const entries: { path: string; folder: boolean }[] = [];
    const walk = async (absDir: string, relDir: string, filter: string) => {
      throwIfAborted(options?.signal);
      const dirents = await readdir(absDir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT" || err.code === "ENOTDIR") return [];
        throw fsError("list", relDir || ".", err);
      });
      for (const d of dirents) {
        if (!d.name.startsWith(filter) || d.isSymbolicLink() || d.name.endsWith(PARTIAL_SUFFIX)) continue;
        const rel = `${relDir}${d.name}`;
        if (d.isDirectory()) {
          if (options?.recursive) await walk(join(absDir, d.name), `${rel}/`, "");
          else entries.push({ path: `${rel}/`, folder: true });
        } else if (d.isFile()) {
          entries.push({ path: rel, folder: false });
        }
      }
    };
    await walk(dir, dirPart, namePart);

    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const start = after === undefined ? 0 : entries.findIndex((e) => e.path > after);
    const page = start === -1 ? [] : entries.slice(start, start + limit);
    const objects: ListedObject[] = [];
    const folders: string[] = [];
    for (const entry of page) {
      if (entry.folder) {
        folders.push(entry.path);
        continue;
      }
      const info = await stat(join(this.resolvedDir, entry.path)).catch(() => null);
      if (info) objects.push({ path: entry.path, size: info.size, lastModified: info.mtime });
    }
    const last = page.at(-1);
    const more = start !== -1 && start + limit < entries.length;
    return { objects, folders, ...(more && last ? { cursor: encodeCursor(last.path) } : {}) };
  }

  /** Copies a file, creating the destination folder. */
  async copy(from: string, to: string, options?: CopyOptions): Promise<void> {
    throwIfAborted(options?.signal);
    const [src, dst] = await this.resolvePair(from, to);
    try {
      await copyFile(src, dst, options?.overwrite ? 0 : constants.COPYFILE_EXCL);
    } catch (err) {
      throw fsError("copy", (err as NodeJS.ErrnoException).code === "EEXIST" ? to : from, err);
    }
  }

  /**
   * Renames a file, creating the destination folder. With `overwrite: false`
   * the destination is checked first, which is not atomic: a file created at
   * `to` in between is replaced. Across disks (`EXDEV`) it copies, then deletes.
   */
  async move(from: string, to: string, options?: CopyOptions): Promise<void> {
    throwIfAborted(options?.signal);
    const [src, dst] = await this.resolvePair(from, to);
    if (!options?.overwrite && (await stat(dst).catch(() => null))) {
      throw new StorageError("conflict", `destination already exists: ${to}`, { provider: "local" });
    }
    try {
      await rename(src, dst);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw fsError("move", from, err);
      await this.copy(from, to, options ?? {});
      await unlink(src).catch((e: unknown) => {
        throw fsError("delete", from, e);
      });
    }
  }

  /** Resolves and checks both paths, requires `from` to be a file, and creates `to`'s folder. */
  private async resolvePair(from: string, to: string): Promise<[string, string]> {
    const src = this.resolveInside(from);
    const dst = this.resolveInside(to);
    await this.assertSafePath(src);
    const info = await stat(src).catch(() => null);
    if (!info?.isFile()) throw new StorageError("not-found", `file not found: ${from}`, { provider: "local" });
    await mkdir(dirname(dst), { recursive: true });
    await this.assertSafePath(dst);
    return [src, dst];
  }
}

/** A filesystem failure as a typed error: missing source, existing destination, or other. */
function fsError(op: string, path: string, err: unknown): StorageError {
  const code = (err as NodeJS.ErrnoException).code;
  const message = `failed to ${op} ${path}: ${(err as Error).message}`;
  if (code === "ENOENT") return new StorageError("not-found", `file not found: ${path}`, { provider: "local", cause: err });
  if (code === "EEXIST") return new StorageError("conflict", `destination already exists: ${path}`, { provider: "local", cause: err });
  return new StorageError("provider-error", message, { provider: "local", cause: err });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError("operation aborted");
}
